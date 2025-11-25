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
global.WETH_USDC = '0x7fCDC35463E3770c2fB992716Cd070B63540b947'; // 0.01%

// mocks must be registered before resolve('db') because it resolves all models which may have deps
const app = new MockApp();
global.container =  app.container;

beforeAll(async () => {
  return app.start(); // connect to db
});
