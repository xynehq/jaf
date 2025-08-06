#!/bin/bash

# Start test databases
echo "Starting test databases with Docker Compose..."
docker-compose -f docker-compose.test.yml up -d

# Wait for services to be ready
echo "Waiting for Redis to be ready..."
for i in {1..30}; do
  if docker-compose -f docker-compose.test.yml exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "Redis is ready!"
    break
  fi
  echo "Waiting for Redis... ($i/30)"
  sleep 1
done

echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker-compose -f docker-compose.test.yml exec -T postgres pg_isready -U faf_test > /dev/null 2>&1; then
    echo "PostgreSQL is ready!"
    break
  fi
  echo "Waiting for PostgreSQL... ($i/30)"
  sleep 1
done

echo "Test databases are ready!"
echo ""
echo "Connection details:"
echo "  Redis: redis://localhost:6379"
echo "  PostgreSQL: postgresql://faf_test:faf_test_password@localhost:5432/faf_test_db"
echo ""
echo "To stop the databases, run: npm run test:db:stop"