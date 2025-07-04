#!/bin/bash

BUILD_FLAG=""
DETACH_FLAG=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -b|--build)
      BUILD_FLAG="--build"
      shift
      ;;
    -d|--detach)
      DETACH_FLAG="-d"
      shift
      ;;
    *)
      echo "Unknown option $1"
      echo "Usage: $0 [-b|--build] [-d|--detach]"
      exit 1
      ;;
  esac
done

echo "Starting services..."
docker-compose up $BUILD_FLAG $DETACH_FLAG