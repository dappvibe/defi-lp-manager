const TelegramMessage = require("../message");
const { getTimeInTimezone, moneyFormat } = require('../../../utils');
const AbstractHandler = require("../handler");

class PositionMessage extends TelegramMessage {
  constructor(position, value, fees, amounts, prices) {
    super();
    this.position = position;
    this.value = value;
    this.fees = fees;
    this.amounts = amounts;
    this.prices = prices;
  }

  toString() {
    const p = this.position;
    const lines = [];

    // Pool price
    const inRange = this.prices.current >= this.prices.lower && this.prices.current <= this.prices.upper;
    const arrow = inRange ? '🟢' : (this.prices.current > this.prices.lower ? '🔴⬆️' : '🔴⬇️');
    lines.push(arrow + ` $${moneyFormat(this.prices.current)}`);

    // Accumulated fees and CAKE rewards
    let feesLine = '';
    feesLine = `💸 $${moneyFormat(this.fees.totalValue)}`;
    feesLine += ` 🍪 $${moneyFormat(this.fees.rewards.value)}`;
    lines.push(feesLine);

    // last update, age, APY
    let timeLine = '⏰ ' + getTimeInTimezone(); // current time to show in UI that it is being updated
    const age = Math.round((new Date() - p.createdAt) / 1000); // seconds
    const hours = Math.floor(age / 3600);
    const minutes = Math.floor(age / 60) % 60;
    timeLine += ' ⏳ ' + `${hours}:${minutes.toString().padStart(2, '0')}`;
    const secondlyReturn = (+this.fees.totalValue + this.fees.rewards.value) / this.value / age;
    const apy = secondlyReturn * 31536000 * 100; // Annualize (31,536,000 seconds per year) and convert to percentage
    timeLine += ` 📈 ${apy.toFixed(2)}%`;
    lines.push(timeLine);

    // token amounts
    let amounts = `💰 ${this.amounts[0].toFixed(6)} ${p.pool.token0.symbol} + `;
    amounts += `${moneyFormat(this.amounts[1])} ${p.pool.token1.symbol}`;
    lines.push(amounts);

    // Staking status and price range
    let rangeLine = p.isStaked ? '🥩 STAKED' : '💼 UNSTAKED';
    const median = (+this.prices.lower + +this.prices.upper) / 2;
    rangeLine += ` | $${moneyFormat(this.prices.lower)} - ($${moneyFormat(median)}) - $${moneyFormat(this.prices.upper)}`;
    lines.push(rangeLine);

    // pool pair and tokenId
    const feePercent = (p.pool.fee / 10000).toFixed(2);
    const posLink = `https://pancakeswap.finance/liquidity/${p.tokenId}?chain=arb&persistChain=1`;
    const poolLink = `https://pancakeswap.finance/liquidity/pool/arb/` + p.pool.address;
    let poolInfo = `[${p.pool.token0.symbol}/${p.pool.token1.symbol}](${poolLink}) (${feePercent}%)`;
    poolInfo += ` - [#${p.tokenId}](${posLink})`;
    lines.push(poolInfo);

    return lines.join('\n');
  }

  get options() {
    return { parse_mode: 'Markdown', disable_web_page_preview: true };
  }
}

/**
 * Handler for /lp command - Lists liquidity positions for monitored wallets
 */
class LpHandler extends AbstractHandler
{
  getMyCommand = () => ['lp', 'List active liquidity pools for your wallets']

  onAir = []; // locks to avoid multiple API calls

  /**
   * Creates an instance of LpHandler
   * @param db
   * @param positionFactory
   * @param cakePool
   */
  constructor(db, positionFactory, cakePool) {
    super(db.model('User'));
    this.db = db;
    this.model = db.model('Message');
    this.positionFactory = positionFactory;
    cakePool.then((pool) => this.cakePool = pool);
  }

  /**
   * Registers bot command handlers for the /lp command
   * @returns {this}
   */
  listenOn(bot) {
    this.bot = bot;
    this.bot.onText(/\/lp/, this.handle.bind(this));

    this.restoreEventListeners().then(c => console.log(`Started monitoring ${c} positions`));

    return this;
  }

  /**
   * Handles the /lp command by processing monitored wallets and their positions
   * @param {Object} msg - Telegram message object
   * @returns {Promise<void>}
   */
  async handle(msg) {
    const chatId = msg.chat.id;

    const user = await this.getUser(msg);
    await user.populate('wallets');
    if (user.wallets.length === 0) {
      return this.bot.send("💼 No wallets are being monitored.\n\nUse /wallet to start monitoring a wallet.", chatId);
    }

    // multiple interval handlers may be created inside loop, clear all to be safe
    let typing = [this.bot.typing(chatId)];

    for (let i = 0; i < user.wallets.length; i++) {
      const wallet = user.wallets[i];
      try {
        let positionsFound = false;
        for await (const position of this.positionFactory.fetchPositions(wallet.address)) {
          if (!position.isEmpty()) {
            positionsFound = true;
            try {
              await this.outputPosition(position, {}, chatId).then();
              this.setEventListeners(position);
            } finally {
              // status is cleared after bot sends a message. Set again. Clear to have single call per chat.
              typing.forEach(clearInterval);
              typing.push(this.bot.typing(chatId));
            }
          }
        }

        if (!positionsFound) {
          this.bot.sendMessage(chatId, `No active positions found in ${user.wallets.length} wallets.`);
        }
      }
      finally {
        typing.forEach(clearInterval);
      }
    }
  }

  /**
   * @param {PositionModel} pos
   * @param {Object} event
   * @param {Number|null} chatId - Send a new message to this chatId
   * @returns {Promise<MessageModel|void>}
   */
  async outputPosition(pos, event, chatId = null) {
    const _id = 'Position_' + pos._id;

    // prevent race condition and identical messages errors
    if (this.onAir[_id]) return;
    this.onAir[_id] = true;

    let doc;
    try {
      if (chatId) { // keep doc null to always send new message if chatId is provided (on /lp command)
        await this.model.deleteOne({_id: 'Range_' + pos._id}); // send new alert to appear after position msg
      }
      else {
        doc = await this.model.findById(_id);
        if (!doc) throw new Error('chatId must be set for new messages: ' + _id);
        chatId = doc.chatId;
      }

      const value = pos.calculateCombinedValue();
      const amounts = pos.calculateTokenAmounts().map(parseFloat);
      const prices = pos.pool.getPrices(pos);
      const fees = await pos.calculateUnclaimedFees();
      const cake = await this.cakePool?.getPrices();
      fees.rewards.value = fees.rewards.amount * cake?.current;

      // Create or update Telegram chat message
      let msg = new PositionMessage(pos, value, fees, amounts, prices);
      msg.chatId = chatId;
      msg.id = doc?.metadata?.id; // update if exists
      if (doc && msg.checksum() === doc.checksum) { // identical to sent (price didn't change even 0.01)
        return; // avoid rejection by Telegram and wasted call
      }

      msg = await this.bot.send(msg);

      // Save message to keep updating after restart
      return this.model.findOneAndUpdate(
        {_id, chatId},
        {_id, chatId, messageId: msg.id, checksum: msg.checksum(), metadata: msg},
        {upsert: true, new: true, setDefaultsOnInsert: true}
      );
    }
    finally {
      delete this.onAir[_id]
    }
  }

  /**
   * Handles range notifications by sending alerts when positions go out of range
   * and removing alerts when they come back in range
   * @param {PositionModel} pos
   * @param inRange
   * @returns {Promise<void>}
   */
  async alertPriceRange(pos, inRange) {
    const _id = 'Range_'+pos._id;

    let alert = await this.model.findById(_id);
    if (!alert && !inRange) { // send alert
      const posMsg = await this.model.findById('Position_'+pos._id);
      if (!posMsg || this.onAir[_id]) return;
      this.onAir[_id] = true;
      try {
        const sent = await this.bot.sendMessage(posMsg.chatId, `⚠️ Position Out of Range`, { reply_to_message_id: posMsg.messageId });
        await this.model.create({_id, chatId: posMsg.chatId, messageId: sent.message_id});
      } finally {
        delete this.onAir[_id];
      }
    }
    else if (alert && inRange) { // back in range - remove alert
      await this.bot.deleteMessage(alert.chatId, alert.messageId);
      await this.model.deleteOne({_id});
    }
  }

  /**
   * @param {PositionModel} pos
   */
  setEventListeners(pos) {
    pos.startMonitoring();
    pos.on('swap',  (swapInfo) => this.outputPosition(pos, swapInfo));
    pos.on('range', (inRange)  => this.alertPriceRange(pos, inRange));
  }

  /**
   * Restores monitoring for all previously monitored positions on startup
   * @returns {Promise<Number>} - Amount of restored positions
   */
  async restoreEventListeners() {
    const messages = await this.model.find({_id: /^Position_/});

    let count = 0;
    for (const msg of messages) {
      const pos = await msg.position;
      if (pos) {
        this.setEventListeners(pos);
        count++;
      } else {
        console.warn('Position does not exist in message: ', msg._id);
        msg.deleteOne(); // FIXME not deleted
      }
    }
    return count;
  }
}

module.exports = LpHandler
