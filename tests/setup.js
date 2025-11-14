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

import { asClass, asValue } from "awilix";
import { createPublicClient, custom } from "viem";
import App from '../src/app'; // envvars are loaded here
import * as mocks from './_mocks/contracts';

const app = new App();
global.container =  app.container;
global.USER_WALLET = '0x1234567890123456789012345678901234567890';
global.WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
global.USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
global.USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

beforeAll(async () => {
  const config = container.resolve('config');
  const db = container.resolve('db');
  await db.connect(config.db.uri, {
    serverSelectionTimeoutMS: 1000
  }).catch(e => {
    if (e.message.includes('timed out')) {
      throw new Error('MongoDB connection timeout. Did you start mongodb docker service?');
    } else throw e;
  });

  // ensure no blockchain requests goes out
  container.register('provider', asValue(createPublicClient({
    chain: 'arbitrum',
    transport: custom({
      request: vi.fn(async ({ method, params }) => {
        if (method === 'eth_blockNumber') {
          return '0x123'; // Mocked block number (300)
        }
      })
    })
  })))
});

beforeEach(() => {
  const erc20Factory = new mocks.MockERC20Factory();
  const poolV3Factory = new mocks.MockPoolV3Factory(erc20Factory);
  const poolContractFactory = new mocks.MockPoolContractFactory(poolV3Factory);
  container.register({
    chainId: asValue(42161), // Arbitrum
    erc20Factory: asValue(erc20Factory.get.bind(erc20Factory)),
    poolFactoryContract: asValue(poolV3Factory),
    poolContract: asValue(poolContractFactory.get.bind(poolContractFactory)),
    positionManager: asValue(new mocks.MockNonfungiblePositionManager()),
    staker: asValue(new mocks.MockStaker)
  });
});
