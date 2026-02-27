#!/usr/bin/env bash
# Test Snackpass service locally. Run with: ./test-services-and-snackpass.sh
set -e
BASE=http://localhost:3000
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
PASS=0
FAIL=0

assert_status() {
  local expected=$1
  local actual=$2
  local name=$3
  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}PASS${NC} $name (HTTP $actual)"
    ((PASS++)) || true
    return 0
  else
    echo -e "${RED}FAIL${NC} $name (expected $expected, got $actual)"
    ((FAIL++)) || true
    return 1
  fi
}

assert_json_contains() {
  local body=$1
  local needle=$2
  local name=$3
  if echo "$body" | grep -qF "$needle"; then
    echo -e "${GREEN}PASS${NC} $name (response contains expected content)"
    ((PASS++)) || true
    return 0
  else
    echo -e "${RED}FAIL${NC} $name (response missing: $needle)"
    echo "  Body: $body"
    ((FAIL++)) || true
    return 1
  fi
}

echo "=== 1. Service info (GET /api/services/snackpass) ==="
code=$(curl -s -o /tmp/snackpass_info.txt -w "%{http_code}" "$BASE/api/services/snackpass")
body=$(cat /tmp/snackpass_info.txt)
assert_status 200 "$code" "GET /api/services/snackpass returns 200"
assert_json_contains "$body" "Snackpass" "Docs include title"
assert_json_contains "$body" "snackpass/order" "Docs include order endpoint"

# Create agent
USERNAME="snacktest_$$"
create_resp=$(curl -s -X POST "$BASE/api/agents/create" -H "Content-Type: application/json" -d "{\"username\":\"$USERNAME\"}")
KEY=$(echo "$create_resp" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)
if [ -z "$KEY" ]; then
  echo -e "${RED}FAIL${NC} Could not create agent"
  exit 1
fi

# Ensure menu item exists (via admin endpoint)
menu_resp=$(curl -s -X POST "$BASE/api/admin/snackpass/menu-items" -H "Content-Type: application/json" -d '{
  "dish_name":"Pollo Asado Burrito",
  "restaurant_name":"La Burrita",
  "restaurant_address":"2524 Durant Ave, Berkeley, CA",
  "base_price_cents":1250,
  "service_fee_cents":75,
  "delivery_fee_cents":0,
  "notes":"Test item",
  "is_active":true
}')

# Order success
order_resp=$(curl -s -o /tmp/snackpass_order.json -w "%{http_code}" -X POST "$BASE/api/services/snackpass/order" -H "Content-Type: application/json" -d "{\"username\":\"$USERNAME\",\"private_key\":\"$KEY\",\"dish_name\":\"Pollo Asado Burrito\",\"restaurant_name\":\"La Burrita\",\"shipping_location\":\"Pickup at 2524 Durant Ave\",\"order_type\":\"pickup\",\"tip_cents\":200}")
code=$order_resp
body=$(cat /tmp/snackpass_order.json)
assert_status 200 "$code" "Snackpass order success returns 200"
assert_json_contains "$body" "payment_url" "Response has payment_url"

# Order history
code=$(curl -s -o /tmp/snackpass_hist.json -w "%{http_code}" -X POST "$BASE/api/services/snackpass/history" -H "Content-Type: application/json" -d "{\"username\":\"$USERNAME\",\"private_key\":\"$KEY\"}")
body=$(cat /tmp/snackpass_hist.json)
assert_status 200 "$code" "Snackpass history returns 200"
assert_json_contains "$body" "orders" "History has orders"

# Unknown dish
code=$(curl -s -o /tmp/snackpass_missing.json -w "%{http_code}" -X POST "$BASE/api/services/snackpass/order" -H "Content-Type: application/json" -d "{\"username\":\"$USERNAME\",\"private_key\":\"$KEY\",\"dish_name\":\"This Dish Does Not Exist\",\"shipping_location\":\"Pickup at 2524 Durant Ave\"}")
body=$(cat /tmp/snackpass_missing.json)
assert_status 404 "$code" "Snackpass order missing dish returns 404"
assert_json_contains "$body" "request_id" "Missing dish returns request_id"


echo ""
echo "=== Summary ==="
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
