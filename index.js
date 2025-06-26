/**
 * Main application entry point
 * This file is responsible for starting the application and handling shutdown
 */

// Import application module
const { initializeApp, cleanupApp } = require('./src/app');

// Application context
let appContext;

/**
 * Start the application
 */
async function main() {
    try {
        appContext = await initializeApp();
        console.log('Application started successfully.');
    } catch (error) {
        console.error('Failed to start application:', error);
        process.exit(1);
    }
}

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
    console.error('Error during application startup:', error);
    process.exit(1);
});
