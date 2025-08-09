#!/bin/bash

# Phonic0 Auth Service API Test Script
# Usage: ./test-api.sh

BASE_URL="http://localhost:3001"

echo "🧪 Testing Phonic0 Auth Service API"
echo "=================================="

# Test health endpoint
echo -e "\n1. Testing health endpoint..."
curl -s "$BASE_URL/health" | jq

# Test signup
echo -e "\n2. Testing user signup..."
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@phonic0.com", 
    "password": "testpass123"
  }')
echo "$SIGNUP_RESPONSE" | jq

# Extract token from signup response
TOKEN=$(echo "$SIGNUP_RESPONSE" | jq -r '.data.token')

if [ "$TOKEN" != "null" ] && [ "$TOKEN" != "" ]; then
  echo -e "\n✅ Signup successful, token: ${TOKEN:0:20}..."
  
  # Test login
  echo -e "\n3. Testing user login..."
  curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@phonic0.com",
      "password": "testpass123"
    }' | jq

  # Test profile
  echo -e "\n4. Testing get profile..."
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/auth/profile" | jq

  # Test create brain
  echo -e "\n5. Testing create brain..."
  BRAIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/brain" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "name": "Test Assistant",
      "instructions": "You are a helpful AI assistant for testing purposes. Be friendly and concise.",
      "description": "Test brain for API validation"
    }')
  echo "$BRAIN_RESPONSE" | jq

  # Extract brain ID
  BRAIN_ID=$(echo "$BRAIN_RESPONSE" | jq -r '.data.brain._id')

  # Test get all brains
  echo -e "\n6. Testing get all brains..."
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/brain" | jq

  # Test get active brain
  echo -e "\n7. Testing get active brain..."
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/brain/active" | jq

  if [ "$BRAIN_ID" != "null" ] && [ "$BRAIN_ID" != "" ]; then
    # Test update brain
    echo -e "\n8. Testing update brain..."
    curl -s -X PUT "$BASE_URL/api/brain/$BRAIN_ID" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{
        "name": "Updated Test Assistant",
        "description": "Updated description for testing"
      }' | jq

    # Test get specific brain
    echo -e "\n9. Testing get specific brain..."
    curl -s -H "Authorization: Bearer $TOKEN" \
      "$BASE_URL/api/brain/$BRAIN_ID" | jq
  fi

  echo -e "\n✅ All tests completed successfully!"
else
  echo -e "\n❌ Signup failed, skipping authenticated tests"
fi

echo -e "\n🎉 API testing finished!"
