const TelegramMessage = require("../message");
const { getTimeInTimezone, moneyFormat } = require('../../../utils');
const AbstractHandler = require("../handler");

class NoPositionsMessage extends TelegramMessage {
  constructor(chatId, wallets) {
    super();
    this.chatId = chatId;
    this.wallets = wallets;
  }

  toString() {
    return `No active positions found in ${this.wallets.length} wallets.`;
  }

  getOptions() {
    return { parse_mode: 'Markdown', disable_web_page_preview: true };
  }
}

/**
 * Reply to position message notifying price is out of range. Delete when back in range.
 */
class RangeNotificationMessage extends TelegramMessage {
  constructor(position, chatId, replyToMessageId) {
    super();
    this.chatId = chatId;
    this.position = position;
    this.replyToMessageId = replyToMessageId;
  }

  toString() {
    return `⚠️ **Position Out of Range**`;
  }

  getOptions() {
    return {
      parse_mode: 'Markdown',
      reply_to_message_id: this.replyToMessageId
    };
  }
}

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
    lines.push((inRange ? '🟢' : '🔴') + ` $${moneyFormat(this.prices.current)}`);

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
    rangeLine += ` | $${moneyFormat(this.prices.lower)} - $${moneyFormat(this.prices.upper)}`;
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
class LpHandler extends AbstractHandler {
  /**
   * Creates an instance of LpHandler
   * @param {Mongoose} db
   * @param UserModel
   * @param MessageModel
   * @param PositionModel
   * @param WalletModel
   * @param positionFactory
   * @param PoolModel
   */
  constructor(db, UserModel, MessageModel, PositionModel, WalletModel, positionFactory, PoolModel) {
    super(UserModel);
    this.db = db;
    this.MessageModel = MessageModel;
    this.positionModel = PositionModel;
    this.WalletModel = WalletModel;
    this.positionFactory = positionFactory;
    this.positionMessages = new Map(); // tokenId => PositionMessage
    this.rangeNotificationMessages = new Map(); // tokenId => RangeNotificationMessage
    this.PoolModel = PoolModel;
  }

  /**
   * Registers bot command handlers for the /lp command
   * @returns {this}
   */
  listenOn(bot) {
    this.bot = bot;
    this.bot.onText(/\/lp/, this.handleCommand.bind(this));

    this.restoreMonitoredPositions().catch(error => {
      console.error('Error during position monitoring restoration:', error);
    });

    return this;
  }

  /**
   * Handles the /lp command by processing monitored wallets and their positions
   * @param {Object} msg - Telegram message object
   * @returns {Promise<void>}
   */
  async handleCommand(msg) {
    const chatId = msg.chat.id;

    const user = await this.getUser(msg);
    await user.populate('wallets');

    if (user.wallets.length === 0) {
      return this.bot.send("💼 No wallets are being monitored.\n\nUse /wallet to start monitoring a wallet.", chatId);
    }

    for (let i = 0; i < user.wallets.length; i++) {
      const wallet = user.wallets[i];

      this.bot.sendChatAction(chatId, 'typing').then();
      const typing = setInterval(() => this.bot.sendChatAction(chatId, 'typing'), 5000);

      try {
        let positionsFound = false;
        for await (const position of this.positionFactory.fetchPositions(wallet.address)) {
          if (!await position.isEmpty()) {
            positionsFound = true;
            const sent = await this.outputPosition(chatId, wallet, position);

            // Save message to keep updating after restart
            const id = 'Position_' + position.id;
            this.MessageModel.findOneAndUpdate(
              {_id: 'Position_' + position.id, chatId},
              {
                _id: 'Position_' + position.id,
                chatId,
                messageId: sent.id,
                metadata: sent
              },
              {upsert: true, new: true, setDefaultsOnInsert: true}
            )
              .then(doc => this.positionMessages.set(position._id, doc));

            // subscribe to blockchain events
            this.subscribeToSwaps(position);
          }
        }

        if (!positionsFound) this.bot.send(new NoPositionsMessage(chatId, user.wallets)).then();
      }
      finally {
        // FIXME typing is cleared after first message and then inconsistently shown
        clearInterval(typing);
      }
    }
  }

  /**
   * Processes a single position, sending a message and starting monitoring
   * @param {string} chatId - Telegram chat ID
   * @param {WalletModel} wallet - Wallet address being processed
   * @param {PositionModel} position - Position object to process
   * @returns {Promise<void>}
   */
  async outputPosition(chatId, wallet, position) {
    const [value, prices, fees, amounts] = await Promise.all([
      position.calculateCombinedValue(),
      position.pool.getPrices(position),
      position.calculateUnclaimedFees(),
      position.calculateTokenAmounts()
    ]);
    fees.rewards.value = fees.rewards.amount * (await this.cakePrice());

    const positionMessage = new PositionMessage(position, value, fees, amounts, prices);
    positionMessage.chatId = chatId;

    return await this.bot.send(positionMessage);
  }

  /**
   * Updates a position message with fresh data from the blockchain
   * @returns {Promise<void>}
   * @param pos
   * @param event
   */
  async updatePosition(pos, event) {
    const msg = this.positionMessages.get(pos._id);
    if (!msg) return;

    const [value, prices, fees, amounts] = await Promise.all([
      pos.calculateCombinedValue(),
      pos.pool.getPrices(pos),
      pos.calculateUnclaimedFees(),
      pos.calculateTokenAmounts()
    ]);
    fees.rewards.value = fees.rewards.amount * (await this.cakePrice());
    const posMessage = new PositionMessage(pos, value, fees, amounts, prices);
    posMessage.id = msg.metadata.id;
    posMessage.chatId = msg.chatId;

    this.bot.send(posMessage);
  }

  subscribeToSwaps(position) {
    position.startMonitoring();
    position.on('swap', (e) => this.updatePosition(position, e));
  }

  /**
   * Handles range notifications by sending alerts when positions go out of range
   * and removing alerts when they come back in range
   * @param {PositionMessage} positionMessage - Position message to check for range changes
   * @returns {Promise<void>}
   */
  async handleRangeNotification(positionMessage) {
    const { position } = positionMessage;
    const tokenId = position.tokenId;
    const hasNotification = this.rangeNotificationMessages.has(tokenId);

    if (!position.inRange && !hasNotification) {
      // Position went out of range - send notification
      // Set a temporary placeholder to prevent race conditions
      this.rangeNotificationMessages.set(tokenId, { sending: true });

      const rangeNotification = new RangeNotificationMessage(
        position,
        positionMessage.chatId,
        positionMessage.id
      );

      try {
        const sentNotification = await this.bot.send(rangeNotification);
        this.rangeNotificationMessages.set(tokenId, sentNotification);
      } catch (error) {
        console.error(`Error sending range notification for position ${tokenId}:`, error);
        // Remove placeholder on error
        this.rangeNotificationMessages.delete(tokenId);
      }
    } else if (position.inRange && hasNotification) {
      const notificationMessage = this.rangeNotificationMessages.get(tokenId);

      // Skip if it's just a placeholder (still sending)
      if (notificationMessage && notificationMessage.sending) {
        return;
      }

      // Position came back in range - delete notification
      try {
        this.rangeNotificationMessages.delete(tokenId);
        await this.bot.deleteMessage(notificationMessage.chatId, notificationMessage.id);
      } catch (error) {
        console.error(`Error deleting range notification for position ${tokenId}:`, error);
      }
    }
  }

  /**
   * Restores monitoring for all previously monitored positions on startup
   * @returns {Promise<void>}
   */
  async restoreMonitoredPositions() {
    console.log('Restoring monitored positions...');
    const messages = await this.db.model('Message').find({_id: /^Position_/});
    let count = 0;

    for (const msg of messages) {
      const pos = await msg.position;

      if (pos === null) {
        console.warn('Position is null for message: ', msg._id);
        msg.deleteOne(); // FIXME not deleted
        continue;
      }

      this.positionMessages.set(pos._id, msg);
      this.subscribeToSwaps(pos);
      count++;
    }
    console.log(`Restored monitoring for ${count} positions`);
  }

  async cakePrice() {
    // CAKE/USDC FIXME somehow in container so that it's chainId aware
    const cakePool = await this.PoolModel.fetch(
      '0x1b896893dfc86bb67cf57767298b9073d2c1ba2c',
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      2500
    );
    const cakePrice = await cakePool.getPrices();
    return cakePrice.current;
  }

  getMyCommand = () => ['lp', 'List active liquidity pools for your wallets']
}

module.exports = LpHandler
