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

import MockApp from "./_mocks/app";

global.USER_WALLET = '0x220866b1a2219f40e72f5c628b65d54268ca3a9d';
global.WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
global.USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
global.USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
global.CAKE = '0x1b896893dfc86bb67Cf57767298b9073D2c1bA2c';
global.WETH_USDC = '0x7fcdc35463e3770c2fb992716cd070b63540b947'; // 0.01%

// mocks must be registered before resolve('db') because it resolves all models which may have deps
const app = new MockApp();
global.container =  app.container;

beforeAll(async () => {
  return app.start(); // connect to db
});


beforeEach(async () => {
  container.resolve('cache').flushAll();

  const ethnode = container.resolve('ethnode');
  await ethnode.stop(); // reset() will clear url and provider will fail
  await ethnode.start();

  await ethnode.forCall(WETH_USDC)
    .forFunction('function liquidity() external view returns (uint128)')
    .thenReturn(['70000000000000000']);
  await ethnode.forCall(WETH_USDC)
    .forFunction('function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)')
    .thenReturn(['4292666912078857421875000', -196474, 88, 100, 100, 216272100, true]);
})
