#!/bin/bash
# Local documentation development server

echo "Starting JAF documentation server..."
echo "Installing/updating dependencies..."
pip install -r requirements.txt

echo "Starting MkDocs development server..."
echo "Documentation will be available at http://127.0.0.1:8000"
echo "Press Ctrl+C to stop the server"
mkdocs serve