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
    const result1 = await safeguards.checkSafeguards("test1", 100, "127.0.0.1");
    console.log("Response:", JSON.stringify(result1, null, 2));
    assert(result1.allowed, "Basic request should be allowed");
    assert(
      result1.message === "Request allowed",
      "Message should indicate request is allowed"
    );
    console.log("✅ Test 1 passed\n");

    // Test 2: Request exceeding max amount
    console.log("📝 Test 2: Request exceeding max amount");
    const result2 = await safeguards.checkSafeguards(
      "test2",
      maxAmount + 1,
      "127.0.0.1"
    );
    console.log("Response:", JSON.stringify(result2, null, 2));
    assert(!result2.allowed, "Request exceeding max amount should be denied");
    assert(
      result2.message.includes("exceeds maximum allowed amount"),
      "Message should indicate amount limit exceeded"
    );
    console.log("✅ Test 2 passed\n");

    // Test 3: Multiple requests from same address
    console.log("📝 Test 3: Multiple requests from same address");
    const address = "test3";
    for (let i = 0; i < numberPerInterval + 1; i++) {
      console.log(`\nRequest ${i + 1}:`);
      const result = await safeguards.checkSafeguards(
        address,
        100,
        "127.0.0.1"
      );
      console.log("Response:", JSON.stringify(result, null, 2));
      if (i < numberPerInterval) {
        assert(result.allowed, `Request ${i + 1} should be allowed`);
      } else {
        assert(!result.allowed, "Request should be denied due to rate limit");
        assert(
          result.message.includes("maximum number of requests"),
          "Message should indicate rate limit reached"
        );
      }
    }
    console.log("✅ Test 3 passed\n");

    // Test 4: Address statistics
    console.log("📝 Test 4: Address statistics");
    const stats = await safeguards.getAddressStats(address);
    console.log("Response:", JSON.stringify(stats, null, 2));
    assert(
      stats.totalRequests === numberPerInterval,
      `Should have ${numberPerInterval} successful requests`
    );
    assert(
      stats.totalAmount === numberPerInterval * 100,
      `Total amount should be ${numberPerInterval * 100}`
    );
    assert(stats.remainingRequests === 0, "Should have 0 remaining requests");
    console.log("✅ Test 4 passed\n");

    // Test 5: Global statistics
    console.log("📝 Test 5: Global statistics");
    const globalStats = await safeguards.getGlobalStats();
    console.log("Response:", JSON.stringify(globalStats, null, 2));
    assert(
      globalStats.totalRequests >= numberPerInterval,
      `Should have at least ${numberPerInterval} total requests`
    );
    assert(
      globalStats.totalAmount >= numberPerInterval * 100,
      `Should have at least ${numberPerInterval * 100} total amount`
    );
    assert(
      globalStats.uniqueAddresses >= 1,
      "Should have at least 1 unique address"
    );
    console.log("✅ Test 5 passed\n");

    // Test 6: Request after exceeding total amount
    console.log("📝 Test 6: Request after exceeding total amount");
    const test6Address = "test6";
    // First request within limits
    const result6_1 = await safeguards.checkSafeguards(
      test6Address,
      maxAmount,
      "127.0.0.1"
    );
    console.log("First request:", JSON.stringify(result6_1, null, 2));
    assert(result6_1.allowed, "First request should be allowed");

    // Second request that would exceed total amount
    const result6_2 = await safeguards.checkSafeguards(
      test6Address,
      1,
      "127.0.0.1"
    );
    console.log("Second request:", JSON.stringify(result6_2, null, 2));
    assert(
      !result6_2.allowed,
      "Second request should be denied due to exceeding total amount"
    );
    assert(
      result6_2.message.includes("would exceed the maximum amount limit"),
      "Message should indicate total amount limit exceeded"
    );
    console.log("✅ Test 6 passed\n");

    console.log("🎉 All tests completed successfully!");
  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  }
}

runTests().catch(console.error);
