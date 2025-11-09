/**
 * Main application entry point
 * This file is responsible for starting the application and handling shutdown
 */
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

const App = require('./src/app');

let app;

async function main() {
  app = new App();
  await app.start();
  console.log('Application started successfully.');
}

/**
 * Graceful shutdown handling
 */
process.on('SIGINT', async () => {
  console.log('Shutting down application...');

  if (app) await app.stop();

  console.log('Shutdown complete.');
  process.exit(0);
});

// Start the application
main().catch(error => {
  console.error('Error during application startup:', error.message);
  process.exit(1);
});
