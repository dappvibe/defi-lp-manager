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
import { asClass, asValue } from "awilix";
import App from '../src/app';
import { MockERC20Factory, MockPoolV3Factory, MockPoolContractFactory, MockNonfungiblePositionManager } from './_mocks/contracts';

// To debug with live API's AND database comment out this line (use with CAUTION! Tests will CLEAR db!)
require('dotenv').config({path: '.env.example'});

const app = new App();
global.container =  app.container;
global.WALLET = '0x1234567890123456789012345678901234567890'; // user
global.WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
global.USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
global.USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

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

  const erc20Factory = new MockERC20Factory();
  const poolV3Factory = new MockPoolV3Factory(erc20Factory);
  const poolContractFactory = new MockPoolContractFactory(poolV3Factory);
  container.register({
    chainId: asValue(11155111), // sepolia
    erc20Factory: asValue(erc20Factory.get.bind(erc20Factory)),
    poolFactoryContract: asValue(poolV3Factory),
    poolContract: asValue(poolContractFactory.get.bind(poolContractFactory)),
    positionManager: asValue(new MockNonfungiblePositionManager()),
  });
});
