import "../styles/main.css";
class App {
  public remoteBackendUrl: string;
  private readonly FIXED_AMOUNT: number = 50; // Fixed amount of 50 DEMOS (100 for addresses with identity)

  constructor() {
    this.remoteBackendUrl = process.env.REMOTE_BACKEND_URL || "";
    this.testBackendUrl();
    this.init();
  }

  private async testBackendUrl(): Promise<void> {
    if (!this.remoteBackendUrl) {
      console.error("REMOTE_BACKEND_URL is not set");
    }
    console.log("Testing REMOTE_BACKEND_URL: " + this.remoteBackendUrl);
    // Trying the basic endpoint (we need a high timeout)
    let result = await fetch(`${this.remoteBackendUrl}/api/test`);
    if (result.status !== 200) {
      console.error(
        "[ERROR] REMOTE_BACKEND_URL is not working: things won't work."
      );
    } else {
      let text = await result.text();
      console.log("REMOTE_BACKEND_URL is working: " + text);
    }
  }

  private async init(): Promise<void> {
    const app = document.getElementById("app");
    if (app) {
      // Add balance display
      const balanceDisplay = document.createElement("div");
      balanceDisplay.className = "balance-display";
      balanceDisplay.innerHTML = `
        <div class="balance-inner">
          <span class="label">Available Balance</span>
          <span class="amount">Loading...</span>
        </div>
      `;
      app
        .querySelector(".faucet-content")
        ?.insertBefore(balanceDisplay, app.querySelector(".faucet-form"));

      // Initial balance fetch
      await this.updateBalance();
    }

    // Faucet form and its event listener
    const faucetForm = document.getElementById("faucet-form");
    if (faucetForm) {
      faucetForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const address = document.getElementById(
          "wallet-address"
        ) as HTMLInputElement;

        // Basic validation
        if (!address.value) {
          this.showError("Please enter a wallet address");
          return;
        }

        this.requestTokens(address.value, this.FIXED_AMOUNT);
      });
    }
  }

  private async updateBalance(): Promise<void> {
    try {
      const response = await fetch(`${this.remoteBackendUrl}/api/balance`);
      if (response.ok) {
        const data = await response.json();
        console.log("Balance response: " + JSON.stringify(data, null, 2));
        const balance = data.body.balance * 10; // Multiply by 10
        console.log("Balance: " + balance);
        const balanceDisplay = document.querySelector(
          ".balance-display .amount"
        );
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

  private showError(message: string): void {
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

  private showSuccess(message: string): void {
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

  private async getBalance(address: string): Promise<void> {
    // TODO: get balance from backend
  }

  private async requestTokens(address: string, amount: number): Promise<void> {
    const submitButton = document.querySelector(
      ".request-button"
    ) as HTMLButtonElement;
    const buttonText = submitButton.querySelector(".button-text");
    const messageContainer = document.getElementById("message-container");
    const messageCard = messageContainer?.querySelector(".message-card");
    const messageContent = document.getElementById("message-content");

    if (
      submitButton &&
      buttonText &&
      messageContainer &&
      messageCard &&
      messageContent
    ) {
      // Show loading state
      submitButton.classList.add("loading");
      buttonText.innerHTML = '<span class="spinner"></span>Processing...';
      messageContainer.classList.add("hidden");

      try {
        // Add timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        let result = await fetch(`${this.remoteBackendUrl}/api/request`, {
          method: "POST",
          body: JSON.stringify({ address, amount }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseData = await result.json();

        if (!result.ok) {
          // Handle specific safeguard errors
          if (responseData.body.includes("exceeds maximum allowed amount")) {
            this.showError(
              "Requested amount exceeds the maximum allowed limit"
            );
          } else if (responseData.body.includes("maximum number of requests")) {
            this.showError(
              "You have reached the maximum number of requests for this time period"
            );
          } else if (
            responseData.body.includes("would exceed the maximum amount limit")
          ) {
            this.showError(
              "This request would exceed your total amount limit for this time period"
            );
          } else {
            this.showError(
              responseData.body || `Server returned ${result.status}`
            );
          }
          throw new Error(
            responseData.body || `Server returned ${result.status}`
          );
        }

        // Show transaction info
        const transactionInfo = document.getElementById("transaction-info");
        const txHashElement = document.getElementById("tx-hash");
        const confirmationBlockElement =
          document.getElementById("confirmation-block");

        if (transactionInfo && txHashElement) {
          txHashElement.innerHTML = `<a href="https://explorer.demos.sh/transactions/${responseData.body.txHash}" target="_blank" rel="noopener noreferrer">${responseData.body.txHash}</a>`;
          if (confirmationBlockElement) {
            confirmationBlockElement.textContent = "Pending confirmation";
          }
          transactionInfo.classList.remove("hidden");
        }

        // Show success message
        this.showSuccess("Tokens requested successfully!");

        // Update balance after successful request
        await this.updateBalance();

        buttonText.textContent = "Success!";
        setTimeout(() => {
          buttonText.textContent = "Request Tokens";
          submitButton.classList.remove("loading");
          // Hide messages after 10 seconds
          messageContainer.classList.add("hidden");
          if (transactionInfo) {
            transactionInfo.classList.add("hidden");
          }
        }, 10000);
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

  private async getTransactionHistory(address: string): Promise<void> {
    // TODO: get transaction history from backend
  }

  private async getTransactionStatus(txHash: string): Promise<void> {
    // TODO: get transaction status from backend
  }
}

new App();
