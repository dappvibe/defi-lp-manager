/**
 * Main application entry point
 * This file is responsible for starting the application and handling shutdown
 */

// Import application module
const { startApp, cleanupApp } = require('./src/app');

// Application context
let appContext;

/**
 * Start the application
 */
async function main() {
  appContext = await startApp();
  console.log('Application started successfully.');
}

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

/**
 * Graceful shutdown handling
 */
process.on('SIGINT', async () => {
  console.log('Shutting down application...');

  if (appContext) {
    await cleanupApp(appContext);
  }

  console.log('Shutdown complete.');
  process.exit(0);
});

// Start the application
main().catch(error => {
  console.error('Error during application startup:', error.message);
  process.exit(1);
});
