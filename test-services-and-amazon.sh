#!/usr/bin/env bash
# Test services API and Amazon integration locally. Run with: ./test-services-and-amazon.sh
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

echo "=== 1. List services (GET /api/services) ==="
code=$(curl -s -o /tmp/svc_list.json -w "%{http_code}" "$BASE/api/services")
body=$(cat /tmp/svc_list.json)
assert_status 200 "$code" "GET /api/services returns 200"
assert_json_contains "$body" "services" "List response has services array"
assert_json_contains "$body" "api/services/amazon" "List includes amazon infoUrl without /info"
assert_json_contains "$body" "api/services/<id>" "List mentions GET /api/services/<id> (no /info)"

echo ""
echo "=== 2. Service info - valid (GET /api/services/amazon) ==="
code=$(curl -s -o /tmp/amazon_info.txt -w "%{http_code}" "$BASE/api/services/amazon")
body=$(cat /tmp/amazon_info.txt)
assert_status 200 "$code" "GET /api/services/amazon returns 200"
assert_json_contains "$body" "Amazon" "Amazon info is markdown with title"
assert_json_contains "$body" "amazon/buy" "Amazon info describes buy endpoint"
assert_json_contains "$body" "amazon/history" "Amazon info describes history endpoint"
assert_json_contains "$body" "send this link to your human" "Amazon info says send link to human"

echo ""
echo "=== 3. Service info - unknown service (GET /api/services/nonexistent) ==="
code=$(curl -s -o /tmp/unknown_svc.json -w "%{http_code}" "$BASE/api/services/nonexistent")
body=$(cat /tmp/unknown_svc.json)
assert_status 404 "$code" "GET /api/services/nonexistent returns 404"
assert_json_contains "$body" "Service not found" "404 body has error message"
assert_json_contains "$body" "GET /api/services" "404 tells to call list services"

echo ""
echo "=== 4. Unsupported service path (POST /api/services/doordash/buy) ==="
code=$(curl -s -o /tmp/doordash_buy.json -w "%{http_code}" -X POST "$BASE/api/services/doordash/buy" -H "Content-Type: application/json" -d '{}')
body=$(cat /tmp/doordash_buy.json)
assert_status 404 "$code" "POST /api/services/doordash/buy returns 404"
assert_json_contains "$body" "Service not found" "Catch-all returns service not found"

echo ""
echo "=== 5. Create agent for Amazon tests ==="
create_resp=$(curl -s -X POST "$BASE/api/agents/create" -H "Content-Type: application/json" -d '{"username":"amazontest"}')
if echo "$create_resp" | grep -q "privateKey"; then
  echo -e "${GREEN}PASS${NC} Agent created"
  ((PASS++)) || true
  USERNAME=amazontest
  PRIVATE_KEY=$(echo "$create_resp" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)
  if [ -z "$PRIVATE_KEY" ]; then
    PRIVATE_KEY=$(node -e "console.log(JSON.parse(process.argv[1]).privateKey)" "$create_resp" 2>/dev/null || echo "")
  fi
else
  echo "$create_resp" | head -1
  if echo "$create_resp" | grep -q "already taken"; then
    echo "Agent amazontest exists, using existing (we need to get key from env or skip auth tests)"
    USERNAME=amazontest
    PRIVATE_KEY=""
  fi
fi
# If we have a key from create, use it; else use a dummy for failure tests only
if [ -z "$PRIVATE_KEY" ]; then
  echo -e "${YELLOW}Note: No new private key (agent may exist). Auth tests will use wrong key for failure cases.${NC}"
  PRIVATE_KEY=wrongkey123
fi

echo ""
echo "=== 6. Amazon buy - edge cases ==="
# Invalid JSON
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/buy" -H "Content-Type: application/json" -d 'not json')
assert_status 400 "$code" "Amazon buy with invalid JSON returns 400"

# Missing required fields
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/buy" -H "Content-Type: application/json" -d '{"username":"amazontest"}')
body=$(cat /tmp/out.json)
assert_status 400 "$code" "Amazon buy without private_key returns 400"
assert_json_contains "$body" "private_key" "Error mentions private_key"

code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/buy" -H "Content-Type: application/json" -d "{\"username\":\"amazontest\",\"private_key\":\"$PRIVATE_KEY\"}")
body=$(cat /tmp/out.json)
assert_status 400 "$code" "Amazon buy without item_url returns 400"

# Invalid credentials (wrong key)
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/buy" -H "Content-Type: application/json" -d '{"username":"amazontest","private_key":"wrongkey","item_url":"https://amazon.com/dp/123","shipping_location":"123 Main St"}')
assert_status 401 "$code" "Amazon buy with wrong private_key returns 401"

# Nonexistent user
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/buy" -H "Content-Type: application/json" -d '{"username":"nonexistentuser99","private_key":"abc","item_url":"https://amazon.com/dp/123","shipping_location":"123 Main St"}')
assert_status 404 "$code" "Amazon buy with nonexistent user returns 404"

echo ""
echo "=== 7. Amazon buy - success (if we have valid key) ==="
# Try with the key we got from create (use unique name so we get a new agent and can test buy/history)
UNIQUE_USER="amazontest_$$"
curl -s -X POST "$BASE/api/agents/create" -H "Content-Type: application/json" -d "{\"username\":\"$UNIQUE_USER\"}" > /tmp/create_agent.json
KEY2=""
if grep -q '"privateKey"' /tmp/create_agent.json 2>/dev/null; then
  KEY2=$(node -e "try { console.log(JSON.parse(require('fs').readFileSync('/tmp/create_agent.json','utf8')).privateKey||'') } catch(e) { console.log('') }" 2>/dev/null)
fi
if [ -n "$KEY2" ]; then
  code=$(curl -s -o /tmp/buy_resp.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/buy" -H "Content-Type: application/json" -d "{\"username\":\"$UNIQUE_USER\",\"private_key\":\"$KEY2\",\"item_url\":\"https://www.amazon.com/dp/B09V3KXJPB\",\"shipping_location\":\"456 Oak Ave\"}")
  body=$(cat /tmp/buy_resp.json)
  assert_status 200 "$code" "Amazon buy success returns 200"
  assert_json_contains "$body" "payment_url" "Response has payment_url"
  assert_json_contains "$body" "Send the payment_url link to your human" "Response says send link to human"
  assert_json_contains "$body" "pay/amazon/" "payment_url points to pay/amazon/"
  ORDER_ID=$(node -e "try { const r=JSON.parse(require('fs').readFileSync('/tmp/buy_resp.json','utf8')); console.log(r.order_id||'') } catch(e) { console.log('') }" 2>/dev/null) || true
else
  echo -e "${YELLOW}Skip${NC} Amazon buy success (could not create fresh agent for key)"
fi

echo ""
echo "=== 8. Amazon history - edge cases ==="
# Invalid JSON
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/history" -H "Content-Type: application/json" -d 'not json')
assert_status 400 "$code" "Amazon history with invalid JSON returns 400"

# Missing private_key
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/history" -H "Content-Type: application/json" -d '{"username":"amazontest2"}')
assert_status 400 "$code" "Amazon history without private_key returns 400"

# Wrong credentials
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/history" -H "Content-Type: application/json" -d '{"username":"amazontest2","private_key":"wrongkey"}')
assert_status 401 "$code" "Amazon history with wrong key returns 401"

# Nonexistent user
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/history" -H "Content-Type: application/json" -d '{"username":"nosuchuser99","private_key":"abc"}')
assert_status 404 "$code" "Amazon history with nonexistent user returns 404"

echo ""
echo "=== 9. Amazon history - success ==="
if [ -n "$KEY2" ]; then
  code=$(curl -s -o /tmp/hist.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/history" -H "Content-Type: application/json" -d "{\"username\":\"$UNIQUE_USER\",\"private_key\":\"$KEY2\"}")
  body=$(cat /tmp/hist.json)
  assert_status 200 "$code" "Amazon history returns 200"
  assert_json_contains "$body" "orders" "Response has orders array"
  assert_json_contains "$body" "Submitted" "Order has placeholder status"
else
  code=$(curl -s -o /tmp/hist.json -w "%{http_code}" -X POST "$BASE/api/services/amazon/history" -H "Content-Type: application/json" -d "{\"username\":\"amazontest\",\"private_key\":\"$PRIVATE_KEY\"}")
  if [ "$code" = "200" ]; then
    assert_json_contains "$(cat /tmp/hist.json)" "orders" "Response has orders"
  else
    echo -e "${YELLOW}Skip${NC} Amazon history success (no valid credentials)"
  fi
fi

echo ""
echo "=== 10. Payment page - invalid order id ==="
code=$(curl -s -o /tmp/out.html -w "%{http_code}" "$BASE/pay/amazon/999999")
body=$(cat /tmp/out.html)
assert_status 200 "$code" "Payment page for non-existent order loads (shows not found message)"
if echo "$body" | grep -qi "not found\|does not exist"; then
  echo -e "${GREEN}PASS${NC} Page mentions order not found"
  ((PASS++)) || true
else
  echo -e "${RED}FAIL${NC} Page should mention order not found. Snapshot: $(echo "$body" | head -c 200)"
  ((FAIL++)) || true
fi

code=$(curl -s -o /tmp/out.html -w "%{http_code}" "$BASE/pay/amazon/0")
body=$(cat /tmp/out.html)
assert_status 200 "$code" "Payment page for id 0 loads"
if echo "$body" | grep -qi "invalid\|not found"; then
  echo -e "${GREEN}PASS${NC} Payment page for id 0 shows invalid/not found"
  ((PASS++)) || true
else
  echo -e "${RED}FAIL${NC} Payment page for id 0 should show invalid or not found"
  ((FAIL++)) || true
fi

echo ""
echo "=== 11. Create session - invalid order_id and missing body ==="
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/pay/amazon/create-session" -H "Content-Type: application/json" -d '{"order_id":999999}')
assert_status 404 "$code" "Create session for non-existent order returns 404"

code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/pay/amazon/create-session" -H "Content-Type: application/json" -d '{}')
assert_status 400 "$code" "Create session without order_id returns 400"

# Invalid order_id types
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/pay/amazon/create-session" -H "Content-Type: application/json" -d '{"order_id":0}')
assert_status 400 "$code" "Create session with order_id 0 returns 400"
code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/pay/amazon/create-session" -H "Content-Type: application/json" -d '{"order_id":"abc"}')
assert_status 400 "$code" "Create session with non-numeric order_id returns 400"

# Valid order but Stripe not configured -> 503 (only when we have an order from this run)
if [ -n "$ORDER_ID" ]; then
  code=$(curl -s -o /tmp/out.json -w "%{http_code}" -X POST "$BASE/api/pay/amazon/create-session" -H "Content-Type: application/json" -d "{\"order_id\":$ORDER_ID}")
  assert_status 503 "$code" "Create session for valid order without Stripe returns 503"
fi

echo ""
echo "=== 12. GET /api/services/<id> for other services (info) ==="
code=$(curl -s -o /tmp/out.txt -w "%{http_code}" "$BASE/api/services/github")
assert_status 200 "$code" "GET /api/services/github returns 200 (placeholder info)"

echo ""
echo "=== Summary ==="
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
