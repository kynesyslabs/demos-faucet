import { FaucetServer } from "./index";
import { Safeguards } from "./safeguards";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Test failed: ${message}`);
  }
}

async function runTests() {
  console.log("🚀 Starting Faucet Safeguards Tests...\n");

  const server = new FaucetServer();
  const safeguards = server.getSafeguards();
  const maxAmount = server.maxAmount;
  const numberPerInterval = server.numberPerInterval;

  console.log(`Using limits from .env:
  Max Amount: ${maxAmount}
  Requests per interval: ${numberPerInterval}
  Time interval: ${server.timeInterval}s\n`);

  try {
    // Test 1: Basic request within limits
    console.log("📝 Test 1: Basic request within limits");
    const result1 = await safeguards.checkAndRecordRequest("0x1111111111111111111111111111111111111111111111111111111111111111", "127.0.0.1");
    console.log("Response:", JSON.stringify(result1, null, 2));
    assert(result1.allowed, "Basic request should be allowed");
    assert(
      result1.message === "Request allowed",
      "Message should indicate request is allowed"
    );
    assert(
      result1.amount === maxAmount,
      `Amount should be ${maxAmount}`
    );
    console.log("✅ Test 1 passed\n");

    // Test 2: Multiple requests from same address (rate limiting)
    console.log("📝 Test 2: Multiple requests from same address");
    const address = "0x2222222222222222222222222222222222222222222222222222222222222222";
    for (let i = 0; i < numberPerInterval + 1; i++) {
      console.log(`\nRequest ${i + 1}:`);
      const result = await safeguards.checkAndRecordRequest(
        address,
        "127.0.0.1"
      );
      console.log("Response:", JSON.stringify(result, null, 2));
      if (i < numberPerInterval) {
        assert(result.allowed, `Request ${i + 1} should be allowed`);
        assert(result.amount === maxAmount, `Amount should be ${maxAmount}`);
      } else {
        assert(!result.allowed, "Request should be denied due to rate limit");
        assert(
          result.message.includes("maximum number of requests"),
          "Message should indicate rate limit reached"
        );
      }
    }
    console.log("✅ Test 2 passed\n");

    // Test 3: Address statistics
    console.log("📝 Test 3: Address statistics");
    const stats = await safeguards.getAddressStats(address);
    console.log("Response:", JSON.stringify(stats, null, 2));
    assert(
      stats.totalRequests === numberPerInterval,
      `Should have ${numberPerInterval} successful requests`
    );
    assert(
      stats.totalAmount === numberPerInterval * maxAmount,
      `Total amount should be ${numberPerInterval * maxAmount}`
    );
    assert(stats.remainingRequests === 0, "Should have 0 remaining requests");
    console.log("✅ Test 3 passed\n");

    // Test 4: Global statistics
    console.log("📝 Test 4: Global statistics");
    const globalStats = await safeguards.getGlobalStats();
    console.log("Response:", JSON.stringify(globalStats, null, 2));
    assert(
      globalStats.totalRequests >= numberPerInterval,
      `Should have at least ${numberPerInterval} total requests`
    );
    assert(
      globalStats.totalAmount >= numberPerInterval * maxAmount,
      `Should have at least ${numberPerInterval * maxAmount} total amount`
    );
    assert(
      globalStats.uniqueAddresses >= 1,
      "Should have at least 1 unique address"
    );
    console.log("✅ Test 4 passed\n");

    console.log("🎉 All tests completed successfully!");
  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  }
}

runTests().catch(console.error);
