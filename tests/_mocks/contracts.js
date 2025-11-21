import { vi } from 'vitest';
import { encodeSqrtRatioX96, TickMath } from '@uniswap/v3-sdk';
//noinspection NpmUsedModulesInstalled uniswap pulls it own OLD version that works, recent break unsiwap sdk
import JSBI from 'jsbi';

class MockNonfungiblePositionManager {
  constructor() {
    this.address = '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364';
    this._positionsData = new Map();
    this._poolIds = new Map();
    this._poolIdToPoolKey = new Map();
    this._nextId = 1n;
    this._nextPoolId = 1n;
    this._owners = new Map();
    this._approvals = new Map();

    this.read = {
      positions: vi.fn().mockImplementation((args) => this._getPositionData(args[0])),
      ownerOf: vi.fn().mockImplementation((args) => this._ownerOf(args[0])),
      getApproved: vi.fn().mockImplementation((args) => this._getApproved(args[0])),
      isApprovedForAll: vi.fn().mockImplementation((args) => this._isApprovedForAll(args[0], args[1])),
      balanceOf: vi.fn().mockImplementation((args) => this._balanceOf(args[0])),
      tokenOfOwnerByIndex: vi.fn().mockImplementation((args) => this._tokenOfOwnerByIndex(args[0], args[1]))
    };

    this.write = {
      mint: vi.fn().mockImplementation((args) => this._mint(args[0])),
      increaseLiquidity: vi.fn().mockImplementation((args) => this._increaseLiquidity(args[0])),
      decreaseLiquidity: vi.fn().mockImplementation((args) => this._decreaseLiquidity(args[0])),
      collect: vi.fn().mockImplementation((args) => this._collect(args[0])),
      burn: vi.fn().mockImplementation((args) => this._burn(args[0])),
      safeTransferFrom: vi.fn().mockImplementation((args) => this._safeTransferFrom(args[0], args[1], args[2])),
      approve: vi.fn().mockImplementation((args) => this._approve(args[0], args[1]))
    };

    this.simulate = {
      mint: vi.fn().mockImplementation((args) => ({ result: this._simulateMint(args[0]) })),
      increaseLiquidity: vi.fn().mockImplementation((args) => ({ result: this._simulateIncreaseLiquidity(args[0]) })),
      decreaseLiquidity: vi.fn().mockImplementation((args) => ({ result: this._simulateDecreaseLiquidity(args[0]) })),
      collect: vi.fn().mockImplementation((args) => ({ result: this._simulateCollect(args[0]) })),
      burn: vi.fn().mockImplementation((args) => ({ result: [true] }))
    };
  }

  _getPositionData(tokenId) {
    const position = this._positionsData.get(tokenId.toString());
    if (!position) throw new Error('Invalid token ID');

    const poolKey = this._poolIdToPoolKey.get(position.poolId);
    if (!poolKey) throw new Error('Pool key not found');

    return [
      position.nonce,
      position.operator,
      poolKey.token0,
      poolKey.token1,
      poolKey.fee,
      position.tickLower,
      position.tickUpper,
      position.liquidity,
      position.feeGrowthInside0LastX128,
      position.feeGrowthInside1LastX128,
      position.tokensOwed0,
      position.tokensOwed1
    ];
  }

  _mint(params) {
    const tokenId = this._nextId++;
    const poolId = this._getOrCreatePoolId(params.token0, params.token1, params.fee);

    const position = {
      nonce: 0n,
      operator: '0x0000000000000000000000000000000000000000',
      poolId,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      liquidity: params.amount0Desired,
      feeGrowthInside0LastX128: 0n,
      feeGrowthInside1LastX128: 0n,
      tokensOwed0: 0n,
      tokensOwed1: 0n
    };

    this._positionsData.set(tokenId.toString(), position);
    this._owners.set(tokenId.toString(), params.recipient);

    return [tokenId, position.liquidity, params.amount0Desired, params.amount1Desired];
  }

  _simulateMint(params) {
    return [1n, params.amount0Desired, params.amount1Desired];
  }

  _increaseLiquidity(params) {
    const position = this._positionsData.get(params.tokenId.toString());
    if (!position) throw new Error('Invalid token ID');

    const liquidityIncrease = params.amount0Desired;
    position.liquidity += liquidityIncrease;

    return [liquidityIncrease, params.amount0Desired, params.amount1Desired];
  }

  _simulateIncreaseLiquidity(params) {
    return [params.amount0Desired, params.amount1Desired];
  }

  _decreaseLiquidity(params) {
    const position = this._positionsData.get(params.tokenId.toString());
    if (!position) throw new Error('Invalid token ID');

    if (position.liquidity < params.liquidity) {
      throw new Error('Insufficient liquidity');
    }

    position.liquidity -= params.liquidity;
    position.tokensOwed0 += params.liquidity / 2n;
    position.tokensOwed1 += params.liquidity / 2n;

    return [params.liquidity / 2n, params.liquidity / 2n];
  }

  _simulateDecreaseLiquidity(params) {
    return [params.liquidity / 2n, params.liquidity / 2n];
  }

  _collect(params) {
    const position = this._positionsData.get(params.tokenId.toString());
    if (!position) throw new Error('Invalid token ID');

    const amount0 = position.tokensOwed0 > params.amount0Max
      ? params.amount0Max
      : position.tokensOwed0;
    const amount1 = position.tokensOwed1 > params.amount1Max
      ? params.amount1Max
      : position.tokensOwed1;

    position.tokensOwed0 -= amount0;
    position.tokensOwed1 -= amount1;

    return [amount0, amount1];
  }

  _simulateCollect(params) {
    const position = this._positionsData.get(params.tokenId.toString());
    if (!position) return [0n, 0n];

    return [position.tokensOwed0, position.tokensOwed1];
  }

  _burn(tokenId) {
    const position = this._positionsData.get(tokenId.toString());
    if (!position) throw new Error('Invalid token ID');

    if (position.liquidity > 0n || position.tokensOwed0 > 0n || position.tokensOwed1 > 0n) {
      throw new Error('Position not cleared');
    }

    this._positionsData.delete(tokenId.toString());
    this._owners.delete(tokenId.toString());
    this._approvals.delete(tokenId.toString());
  }

  _ownerOf(tokenId) {
    const owner = this._owners.get(tokenId.toString());
    if (!owner) throw new Error('Token does not exist');
    return owner;
  }

  _getApproved(tokenId) {
    if (!this._positionsData.has(tokenId.toString())) {
      throw new Error('Token does not exist');
    }
    return this._approvals.get(tokenId.toString()) || '0x0000000000000000000000000000000000000000';
  }

  _isApprovedForAll(owner, operator) {
    return false;
  }

  _balanceOf(account) {
    let count = 0n;
    for (const owner of this._owners.values()) {
      if (owner.toLowerCase() === account.toLowerCase()) count++;
    }
    return count;
  }

  _tokenOfOwnerByIndex(account, index) {
    const accountLower = account.toLowerCase();
    let count = 0;
    for (const [tokenId, owner] of this._owners.entries()) {
      if (owner.toLowerCase() === accountLower) {
        if (count === index) return BigInt(tokenId);
        count++;
      }
    }
    throw new Error('Owner index out of bounds');
  }

  _approve(to, tokenId) {
    if (!this._positionsData.has(tokenId.toString())) {
      throw new Error('Token does not exist');
    }
    this._approvals.set(tokenId.toString(), to);
    return true;
  }

  _safeTransferFrom(from, to, tokenId) {
    const owner = this._owners.get(tokenId.toString());
    if (!owner || owner.toLowerCase() !== from.toLowerCase()) {
      throw new Error('Not token owner');
    }

    this._owners.set(tokenId.toString(), to);
    this._approvals.delete(tokenId.toString());
    return true;
  }

  _getOrCreatePoolId(token0, token1, fee) {
    const poolKey = this._normalizePoolKey(token0, token1, fee);
    const key = JSON.stringify(poolKey);

    let poolId = this._poolIds.get(key);
    if (!poolId) {
      poolId = this._nextPoolId++;
      this._poolIds.set(key, poolId);
      this._poolIdToPoolKey.set(poolId, poolKey);
    }

    return poolId;
  }

  _normalizePoolKey(token0, token1, fee) {
    const [t0, t1] = token0.toLowerCase() < token1.toLowerCase()
      ? [token0, token1]
      : [token1, token0];

    return { token0: t0, token1: t1, fee };
  }

  setupPosition(tokenId, overrides = {}) {
    const defaults = {
      nonce: 0n,
      operator: '0x0000000000000000000000000000000000000000',
      poolId: 1n,
      tickLower: -10000,
      tickUpper: -5000,
      liquidity: 123345678909887641n,
      feeGrowthInside0LastX128: 0n,
      feeGrowthInside1LastX128: 0n,
      tokensOwed0: 100n,
      tokensOwed1: 200n
    };

    const position = { ...defaults, ...overrides };
    this._positionsData.set(tokenId.toString(), position);
    this._owners.set(tokenId.toString(), overrides.owner || USER_WALLET);

    if (!this._poolIdToPoolKey.has(position.poolId)) {
      this._poolIdToPoolKey.set(position.poolId, {
        token0: overrides.token0 || WETH,
        token1: overrides.token1 || USDT,
        fee: overrides.fee || 100
      });
    }
  }

  reset() {
    this._positionsData.clear();
    this._poolIds.clear();
    this._poolIdToPoolKey.clear();
    this._owners.clear();
    this._approvals.clear();
    this._nextId = 1n;
    this._nextPoolId = 1n;

    Object.values(this.read).forEach(fn => fn.mockClear());
    Object.values(this.write).forEach(fn => fn.mockClear());
  }
}

class MockStaker extends MockNonfungiblePositionManager {
  constructor() {
    super();
    this._userPositionInfosData = new Map();
    this._pendingCakeData = new Map();

    this.read.userPositionInfos = vi.fn().mockImplementation(args => this._getUserPositionInfo(args[0]));
    this.read.pendingCake = vi.fn().mockImplementation(args => this._getPendingCake(args[0]));
  }

  _getUserPositionInfo(tokenId) {
    const position = this._userPositionInfosData.get(tokenId.toString());
    if (!position) {
      return [0n, 0n, 0, 0, 0n, 0n, '0x0000000000000000000000000000000000000000', 0n, 0n];
    }

    return [
      position.liquidity,
      position.boostLiquidity,
      position.tickLower,
      position.tickUpper,
      position.rewardGrowthInside,
      position.reward,
      position.user,
      position.pid,
      position.boostMultiplier
    ];
  }

  _getPendingCake(tokenId) {
    return this._pendingCakeData.get(tokenId.toString()) || 0n;
  }

  setupUserPositionInfo(tokenId, overrides = {}) {
    const defaults = {
      liquidity: 1000000000000000n,
      boostLiquidity: 0n,
      tickLower: -100,
      tickUpper: 100,
      rewardGrowthInside: 0n,
      reward: 0n,
      user: USER_WALLET,
      pid: 1n,
      boostMultiplier: 1n
    };
    this._userPositionInfosData.set(tokenId.toString(), { ...defaults, ...overrides });
    this.setupPendingCake(tokenId, 314000000n)
  }

  setupPendingCake(tokenId, amount) {
    this._pendingCakeData.set(tokenId.toString(), amount);
  }

  reset() {
    super.reset();
    this._userPositionInfosData.clear();
    this._pendingCakeData.clear();
    Object.values(this.simulate).forEach(fn => fn.mockClear());
  }
}

class MockPoolV3 {
  constructor(token0, token1, fee) {
    this._token0 = token0;
    this._token1 = token1;
    this._fee = fee;
    this._sqrtPriceX96 = 79228162514264337593543950336n; // 1:1 price
    this._tick = -7500;
    this._liquidity = 1000000n;
    this._positions = new Map();

    this.read = {
      slot0: vi.fn().mockImplementation(() => this._slot0()),
      liquidity: vi.fn().mockImplementation(() => this._liquidity),
      positions: vi.fn().mockImplementation((args) => this._getPosition(args[0])),
      token0: vi.fn().mockResolvedValue(this._token0),
      token1: vi.fn().mockResolvedValue(this._token1),
      fee: vi.fn().mockResolvedValue(this._fee)
    };

    this.write = {
      burn: vi.fn().mockImplementation((args) => this._burn(args[0], args[1], args[2])),
      collect: vi.fn().mockImplementation((args) => this._collect(...args))
    };

    this.watchEvent = {
      Swap: vi.fn().mockImplementation((filters, options) => {
        return () => {}; // unsubscribe function
      })
    };
  }

  _slot0() {
    return [
      this._sqrtPriceX96,
      this._tick,
      0, // observationIndex
      1, // observationCardinality
      1, // observationCardinalityNext
      0, // feeProtocol
      true // unlocked
    ];
  }

  _getPosition(positionKey) {
    const position = this._positions.get(positionKey) || {
      liquidity: 0n,
      feeGrowthInside0LastX128: 0n,
      feeGrowthInside1LastX128: 0n,
      tokensOwed0: 0n,
      tokensOwed1: 0n
    };

    return [
      position.liquidity,
      position.feeGrowthInside0LastX128,
      position.feeGrowthInside1LastX128,
      position.tokensOwed0,
      position.tokensOwed1
    ];
  }

  _burn(tickLower, tickUpper, amount) {
    return [amount / 2n, amount / 2n];
  }

  _collect(recipient, tickLower, tickUpper, amount0Requested, amount1Requested) {
    return [amount0Requested, amount1Requested];
  }

  setPrice(sqrtPriceX96, tick = -7500) {
    this._sqrtPriceX96 = sqrtPriceX96;
    this._tick = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96.toString()));
  }

  setLiquidity(liquidity) {
    this._liquidity = liquidity;
  }

  setPosition(positionKey, position) {
    this._positions.set(positionKey, position);
  }

  reset() {
    this._positions.clear();
    this._sqrtPriceX96 = 79228162514264337593543950336n;
    this._tick = 0;
    this._liquidity = 1000000n;

    Object.values(this.read).forEach(fn => fn.mockClear());
    Object.values(this.write).forEach(fn => fn.mockClear());
  }
}

class MockPoolV3Factory {
  constructor(erc20Factory) {
    this._pools = new Map();
    this._erc20Factory = erc20Factory;

    this.read = {
      getPool: vi.fn().mockImplementation((args) => this._getPool(args[0], args[1], args[2]))
    };
  }

  _getPool(token0, token1, fee) {
    const key = this._getPoolKey(token0, token1, fee);
    const pool = this._pools.get(key);
    return pool ? pool.address : '0x0000000000000000000000000000000000000000';
  }

  _getPoolKey(token0, token1, fee) {
    const [t0, t1] = token0.toLowerCase() < token1.toLowerCase()
      ? [token0.toLowerCase(), token1.toLowerCase()]
      : [token1.toLowerCase(), token0.toLowerCase()];
    return `${t0}-${t1}-${fee}`;
  }

  _registerPool(token0, token1, fee, address, price) {
    const key = this._getPoolKey(token0, token1, fee);
    const pool = new MockPoolV3(token0, token1, fee);

    token0 = this._erc20Factory.get(token0);
    token1 = this._erc20Factory.get(token1);

    const sqrtPriceX96 = encodeSqrtRatioX96(
      Math.floor(price * Math.pow(10, token1._decimals)),
      Math.pow(10, token0._decimals) // per 1 token0
    );

    pool.setPrice(BigInt(sqrtPriceX96.toString()));
    pool.address = address.toLowerCase();
    this._pools.set(key, pool);
  }

  getPool(address) {
    for (const pool of this._pools.values()) {
      if (pool.address === address.toLowerCase()) {
        return pool;
      }
    }
    return null;
  }

  registerPool(token0, token1, fee, address, price) {
    this._registerPool(token0, token1, fee, address, price);
  }

  reset() {
    this._pools.forEach(pool => pool.reset());
    this._pools.clear();
  }
}

class MockPoolContractFactory {
  constructor(poolFactory) {
    this._poolFactory = poolFactory;
  }

  get(address) {
    return this._poolFactory.getPool(address);
  }

  reset() {
    this._poolFactory.reset();
  }
}

class MockERC20Token {
  constructor(symbol = 'MOCK', decimals = 18, totalSupply = 1000000n * 10n ** 18n) {
    this._balances = new Map();
    this._allowances = new Map();
    this._totalSupply = totalSupply;
    this._name = `Mock ${symbol}`;
    this._symbol = symbol;
    this._decimals = decimals;

    this.read = {
      name: vi.fn().mockResolvedValue(this._name),
      symbol: vi.fn().mockResolvedValue(this._symbol),
      decimals: vi.fn().mockResolvedValue(this._decimals),
      totalSupply: vi.fn().mockResolvedValue(this._totalSupply),
      balanceOf: vi.fn().mockImplementation((args) => this._balanceOf(args[0])),
      allowance: vi.fn().mockImplementation((args) => this._allowance(args[0], args[1]))
    };

    this.write = {
      transfer: vi.fn().mockImplementation((args) => this._transfer(args[0], args[1])),
      transferFrom: vi.fn().mockImplementation((args) => this._transferFrom(args[0], args[1], args[2])),
      approve: vi.fn().mockImplementation((args) => this._approve(args[0], args[1])),
      increaseAllowance: vi.fn().mockImplementation((args) => this._increaseAllowance(args[0], args[1])),
      decreaseAllowance: vi.fn().mockImplementation((args) => this._decreaseAllowance(args[0], args[1]))
    };
  }

  _balanceOf(account) {
    return this._balances.get(account.toLowerCase()) || 0n;
  }

  _allowance(owner, spender) {
    const key = `${owner.toLowerCase()}-${spender.toLowerCase()}`;
    return this._allowances.get(key) || 0n;
  }

  _transfer(to, amount) {
    if (amount <= 0n) throw new Error('Transfer amount must be positive');
    return true;
  }

  _transferFrom(from, to, amount) {
    const fromBalance = this._balanceOf(from);
    if (fromBalance < amount) throw new Error('Insufficient balance');

    const key = `${from.toLowerCase()}-${to.toLowerCase()}`;
    const allowance = this._allowances.get(key) || 0n;
    if (allowance < amount) throw new Error('Insufficient allowance');

    this._balances.set(from.toLowerCase(), fromBalance - amount);
    this._balances.set(to.toLowerCase(), this._balanceOf(to) + amount);
    this._allowances.set(key, allowance - amount);

    return true;
  }

  _approve(spender, amount) {
    const key = `${spender.toLowerCase()}`;
    this._allowances.set(key, amount);
    return true;
  }

  _increaseAllowance(spender, addedValue) {
    const key = `${spender.toLowerCase()}`;
    const currentAllowance = this._allowances.get(key) || 0n;
    this._allowances.set(key, currentAllowance + addedValue);
    return true;
  }

  _decreaseAllowance(spender, subtractedValue) {
    const key = `${spender.toLowerCase()}`;
    const currentAllowance = this._allowances.get(key) || 0n;
    if (currentAllowance < subtractedValue) throw new Error('Decreased allowance below zero');

    this._allowances.set(key, currentAllowance - subtractedValue);
    return true;
  }

  setBalance(account, amount) {
    this._balances.set(account.toLowerCase(), amount);
  }

  setAllowance(owner, spender, amount) {
    const key = `${owner.toLowerCase()}-${spender.toLowerCase()}`;
    this._allowances.set(key, amount);
  }

  reset() {
    Object.values(this.read).forEach(fn => fn.mockClear());
    Object.values(this.write).forEach(fn => fn.mockClear());
  }
}

class MockERC20Factory {
  constructor() {
    this._tokens = new Map();

    // Register common tokens
    this.create('0x82af49447d8a07e3bd95bd0d56f35241523fbab1', {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      totalSupply: 1000000n * 10n ** 18n
    });

    this.create('0xaf88d065e77c8cc2239327c5edb3a432268e5831', {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      totalSupply: 1000000000n * 10n ** 6n
    });

    this.create('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      totalSupply: 1000000000n * 10n ** 6n
    });

    this.create('0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', {
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      totalSupply: 21000000n * 10n ** 8n
    });

    this.create('0x1b896893dfc86bb67Cf57767298b9073D2c1bA2c', {
      symbol: 'CAKE',
      name: 'PancakeSwap Token',
      decimals: 18,
      totalSupply: 1000000000000000000000000000n
    })
  }

  create(address, overrides = {}) {
    const mock = new MockERC20Token(overrides.symbol, overrides.decimals, overrides.totalSupply);
    this._tokens.set(address.toLowerCase(), mock);
    return mock;
  }

  get(address) {
    const mock = this._tokens.get(address.toLowerCase());
    if (mock) return mock;
    // FIXME this is incorrect because contract will be created, but exception thrown on any method call
    // hence need to return always-fail ERC20 mock
    else throw new Error('returned no data');
  }

  reset() {
    this._tokens.forEach(token => token.reset());
    this._tokens.clear();
  }
}

module.exports = {
  MockNonfungiblePositionManager,
  MockStaker,
  MockERC20Factory,
  MockPoolV3Factory,
  MockPoolContractFactory,
};
