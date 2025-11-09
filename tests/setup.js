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

// Load .env to run with live API's AND database (use with CAUTION!)
require('dotenv').config({path: '.env.example'});

import App from '../src/app';

const app = new App();

global.container =  app.container;

beforeAll(async () => {
  const config = container.resolve('config');
  const db = container.resolve('db');
  await db.connect(config.db.uri);
});
