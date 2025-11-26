/**
 * Build app container available in all tests.
 * Services are not mocked by default. To mock specific services in tests call container.register()
 *
 * What is changed in the original container:
 *  1. Another database
 *  2. API keys are removed to not acidentally call live services
 *
 * See .env.example for details.
 */
// To debug with live API's AND database comment out this line (use with CAUTION! Tests will CLEAR db!)
require('dotenv').config({path: '.env.example'});

import MockApp from "./app";

global.USER_WALLET = '0x220866b1a2219f40e72f5c628b65d54268ca3a9d';
global.WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
global.USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
global.USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
global.CAKE = '0x1b896893dfc86bb67cf57767298b9073d2c1ba2c';
global.WETH_USDC = '0x7fcdc35463e3770c2fb992716cd070b63540b947'; // 0.01%
global.CAKE_USDC = '0xdaa5b2e06ca117f25c8d62f7f7fbaedcf7a939f4'; // 0.25%

// mocks must be registered before resolve('db') because it resolves all models which may have deps
const app = new MockApp();
global.container =  app.container;

beforeAll(async () => {
  return app.start(); // connect to db
});

beforeEach(async () => {
  container.resolve('cache').flushAll();
  const positionManager = container.resolve('positionManager');
  const staker = container.resolve('staker');

  const ethnode = container.resolve('ethnode');
  await ethnode.stop(); // reset() will clear url and provider will fail
  await ethnode.start();

  await ethnode.forCall(WETH_USDC)
    .forFunction('function liquidity() external view returns (uint128)')
    .thenReturn(['70000000000000000']);
  await ethnode.forCall(WETH_USDC)
    .forFunction('function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)')
    .thenReturn(['4292666912078857421875000', -196474, 88, 100, 100, 216272100, true]);
  await ethnode.forCall(positionManager.address)
    .forFunction('function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)')
    .withParams([31337])
    .thenReturn([
      0n,
      '0x0000000000000000000000000000000000000000',
      WETH,
      USDC,
      100n,
      -195678,
      -195611,
      16858489095148n,
      115792089237316195423570985008687907835793674145050514846788177623488322407647n,
      115792089237316195423570985008687907853269984603353251375712494359446420094239n,
      0n,
      0n
    ]);
  await ethnode.forCall(positionManager.address)
    .forFunction('function ownerOf(uint256 tokenId) external view returns (address)')
    .withParams([31337])
    .thenReturn([USER_WALLET]);
  await ethnode.forCall(positionManager.address)
    .forFunction('function balanceOf(address account) external view returns (uint256)')
    .withParams([USER_WALLET])
    .thenReturn([0]);
  await ethnode.forCall(staker.address)
    .forFunction('function balanceOf(address account) external view returns (uint256)')
    .withParams([USER_WALLET])
    .thenReturn([1]);
  await ethnode.forCall(staker.address)
    .forFunction('function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)')
    .thenReturn([31337n]);
  await ethnode.forCall(positionManager.address)
    .forFunction('function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max))')
    .thenReturn(['uint256', 'uint256'], [
      10000000000000000n, 20000n // 0.01 WETH, 0.02 USDC
    ])
})
