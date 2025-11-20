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
import { MockTelegram } from "./services/telegram/_mocks";

global.USER_WALLET = '0x220866b1a2219f40e72f5c628b65d54268ca3a9d';
global.WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
global.USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
global.USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

const provider = createPublicClient({
  chain: 'arbitrum',
  transport: custom({
    request: vi.fn(async ({ method, params }) => {
      if (method === 'eth_blockNumber') {
        return '0x123'; // Mocked block number (300)
      }
    })
  })
});

const erc20Factory = new mocks.MockERC20Factory();
const poolV3Factory = new mocks.MockPoolV3Factory(erc20Factory);
poolV3Factory.registerPool(WETH, USDC, 100, '0x17c14d2c404d167802b16c450d3c99f88f2c4f4d', 3500.51);
poolV3Factory.registerPool(WETH, USDT, 100, '0x389938cf14be379217570d8e4619e51fbdafaa21', 3499.99);
poolV3Factory.registerPool(USDC, USDT, 100, '0x641c00a822e8b671738d32a431a4fb6074e5c79d', 1.01);
const poolContractFactory = new mocks.MockPoolContractFactory(poolV3Factory);

// mocks must be registered before resolve('db') because it resolves all models which may have deps
const app = new App({
  provider: asValue(provider),
  erc20Factory: asValue(erc20Factory.get.bind(erc20Factory)),
  poolFactoryContract: asValue(poolV3Factory),
  poolContract: asValue(poolContractFactory.get.bind(poolContractFactory)),
  positionManager: asValue(new mocks.MockNonfungiblePositionManager()),
  staker: asValue(new mocks.MockStaker),
  telegram: asClass(MockTelegram)
});

global.container =  app.container;

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
});
