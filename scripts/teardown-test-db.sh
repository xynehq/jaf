#!/bin/bash

# Stop test databases
echo "Stopping test databases..."
docker-compose -f docker-compose.test.yml down

echo "Test databases stopped."