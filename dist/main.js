// src/scripts/main.ts
class App {
  remoteBackendUrl;
  FIXED_AMOUNT = 10;
  constructor() {
    this.remoteBackendUrl = process.env.REMOTE_BACKEND_URL || "";
    this.testBackendUrl();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }
  }
  async testBackendUrl() {
    if (!this.remoteBackendUrl) {
      console.error("REMOTE_BACKEND_URL is not set");
    }
    console.log("Testing REMOTE_BACKEND_URL: " + this.remoteBackendUrl);
    let result = await fetch(`${this.remoteBackendUrl}/api/test`);
    if (result.status !== 200) {
      console.error("[ERROR] REMOTE_BACKEND_URL is not working: things won't work.");
    } else {
      let text = await result.text();
      console.log("REMOTE_BACKEND_URL is working: " + text);
    }
  }
  async init() {
    const app = document.getElementById("app");
    if (app) {
      const balanceDisplay = document.createElement("div");
      balanceDisplay.className = "balance-display";
      balanceDisplay.innerHTML = `
        <div class="balance-inner">
          <span class="label">Available Balance</span>
          <span class="amount">Loading...</span>
        </div>
      `;
      app.querySelector(".faucet-content")?.insertBefore(balanceDisplay, app.querySelector(".faucet-form"));
      await this.updateBalance();
    }
    const faucetForm = document.getElementById("faucet-form");
    if (faucetForm) {
      faucetForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const address = document.getElementById("wallet-address");
        if (!address.value) {
          this.showError("Please enter a wallet address");
          return;
        }
        this.requestTokens(address.value, this.FIXED_AMOUNT);
      });
    }
  }
  async updateBalance() {
    try {
      const response = await fetch(`${this.remoteBackendUrl}/api/balance`);
      if (response.ok) {
        const data = await response.json();
        console.log("Balance response: " + JSON.stringify(data, null, 2));
        const balance = data.body.balance * 10;
        console.log("Balance: " + balance);
        const balanceDisplay = document.querySelector(".balance-display .amount");
        if (balanceDisplay) {
          balanceDisplay.textContent = `${balance} DEMOS`;
        }
      } else {
        console.error("Failed to fetch balance");
      }
    } catch (error) {
      console.error("Error fetching balance:", error);
    }
  }
  showError(message) {
    const messageContainer = document.getElementById("message-container");
    const messageCard = messageContainer?.querySelector(".message-card");
    const messageContent = document.getElementById("message-content");
    if (messageContainer && messageCard && messageContent) {
      messageCard.classList.remove("success");
      messageCard.classList.add("error");
      messageContent.innerHTML = message;
      messageContainer.classList.remove("hidden");
    }
  }
  showSuccess(message) {
    const messageContainer = document.getElementById("message-container");
    const messageCard = messageContainer?.querySelector(".message-card");
    const messageContent = document.getElementById("message-content");
    if (messageContainer && messageCard && messageContent) {
      messageCard.classList.remove("error");
      messageCard.classList.add("success");
      messageContent.innerHTML = message;
      messageContainer.classList.remove("hidden");
    }
  }
  async getBalance(address) {
  }
  async requestTokens(address, amount) {
    const submitButton = document.querySelector(".request-button");
    const buttonText = submitButton.querySelector(".button-text");
    const messageContainer = document.getElementById("message-container");
    const messageCard = messageContainer?.querySelector(".message-card");
    const messageContent = document.getElementById("message-content");
    if (submitButton && buttonText && messageContainer && messageCard && messageContent) {
      submitButton.classList.add("loading");
      buttonText.innerHTML = '<span class="spinner"></span>Processing...';
      messageContainer.classList.add("hidden");
      try {
        const controller = new AbortController;
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        let result = await fetch(`${this.remoteBackendUrl}/api/request`, {
          method: "POST",
          body: JSON.stringify({ address, amount }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const responseData = await result.json();
        if (!result.ok) {
          if (responseData.body.includes("exceeds maximum allowed amount")) {
            this.showError("Requested amount exceeds the maximum allowed limit");
          } else if (responseData.body.includes("maximum number of requests")) {
            this.showError("You have reached the maximum number of requests for this time period");
          } else if (responseData.body.includes("would exceed the maximum amount limit")) {
            this.showError("This request would exceed your total amount limit for this time period");
          } else {
            this.showError(responseData.body || `Server returned ${result.status}`);
          }
          throw new Error(responseData.body || `Server returned ${result.status}`);
        }
        const transactionInfo = document.getElementById("transaction-info");
        const txHashElement = document.getElementById("tx-hash");
        const confirmationBlockElement = document.getElementById("confirmation-block");
        if (transactionInfo && txHashElement && confirmationBlockElement) {
          txHashElement.innerHTML = `<a href="https://explorer.demos.sh/transactions/${responseData.body.txHash}" target="_blank" rel="noopener noreferrer">${responseData.body.txHash}</a>`;
          confirmationBlockElement.textContent = responseData.body.confirmationBlock.toString();
          transactionInfo.classList.remove("hidden");
        }
        this.showSuccess("Tokens requested successfully!");
        await this.updateBalance();
        buttonText.textContent = "Success!";
        setTimeout(() => {
          buttonText.textContent = "Request Tokens";
          submitButton.classList.remove("loading");
          messageContainer.classList.add("hidden");
          if (transactionInfo) {
            transactionInfo.classList.add("hidden");
          }
        }, 1e4);
      } catch (error) {
        let errorMessage = "Error - Try Again";
        if (error instanceof Error) {
          if (error.name === "AbortError") {
            errorMessage = "Request timed out";
          } else if (error.message.includes("Failed to fetch")) {
            errorMessage = "Network error - Check connection";
          } else {
            errorMessage = error.message;
          }
        }
        this.showError(errorMessage);
        buttonText.textContent = errorMessage;
        submitButton.classList.remove("loading");
        console.error("Error requesting tokens:", error);
      }
    }
  }
  async getTransactionHistory(address) {
  }
  async getTransactionStatus(txHash) {
  }
}
new App;
