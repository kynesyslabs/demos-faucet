#!/bin/bash

BUILD_FLAG=""
DETACH_FLAG=""
NO_CACHE_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -b|--build)
      BUILD_FLAG="--build"
      shift
      ;;
    -n|--no-cache)
      NO_CACHE_FLAG="--no-cache"
      shift
      ;;
    -d|--detach)
      DETACH_FLAG="-d"
      shift
      ;;
    *)
      echo "Unknown option $1"
      echo "Usage: $0 [-b|--build] [-n|--no-cache] [-d|--detach]"
      exit 1
      ;;
  esac
done

# If no-cache is specified, we need to build separately
if [[ -n "$NO_CACHE_FLAG" ]]; then
  echo "Building services with no cache..."
  docker-compose build $NO_CACHE_FLAG
  echo "Starting services..."
  docker-compose up $DETACH_FLAG
else
  echo "Starting services..."
  docker-compose up $BUILD_FLAG $DETACH_FLAG
fi