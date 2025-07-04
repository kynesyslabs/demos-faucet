#!/bin/bash

BUILD_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -b|--build)
      BUILD_FLAG="--build"
      shift
      ;;
    *)
      echo "Unknown option $1"
      echo "Usage: $0 [-b|--build]"
      exit 1
      ;;
  esac
done

echo "Restarting services..."
docker-compose down
docker-compose up $BUILD_FLAG