# Use an official Node.js LTS image as the base image
FROM node:lts

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if you have one) to the working directory
# This helps with caching: if your dependencies haven't changed, Docker can use the cached layer
COPY package*.json ./

# Install the project dependencies
RUN npm install

# Copy the rest of your application code, including the .env file, to the working directory
COPY . .

# Expose any ports your application listens on (if any). 
# Your Telegram bot likely doesn't listen on a port, but it's good practice
# EXPOSE 3000 

# Define the command to run your application
# Use CMD to specify the command that runs when the container starts
CMD [ "node", "index.js" ]