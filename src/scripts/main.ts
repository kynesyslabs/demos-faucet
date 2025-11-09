class App {
  public remoteBackendUrl: string;
  // Note: Amount is now determined by the server (50 DEM base, 100 DEM with identity)
  // This constant is no longer sent to the backend
  private readonly FIXED_AMOUNT: number = 10; // Legacy - not used for requests

  constructor() {
    // Use window global injected by server, fallback to docker internal URL
    this.remoteBackendUrl = (window as any).__BACKEND_URL__ || 
                           "http://backend:3010";
    console.log("Using backend URL:", this.remoteBackendUrl);
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
    // Initial status fetch
    await this.updateFaucetStatus();

    // Set up periodic status updates every 30 seconds
    setInterval(() => {
      this.updateFaucetStatus();
    }, 30000);

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

        this.requestTokens(address.value);
      });
    }
  }

  private async updateFaucetStatus(): Promise<void> {
    const faucetAddress = document.getElementById("faucet-address");
    const faucetBalance = document.getElementById("faucet-balance");
    const connectionStatus = document.getElementById("connection-status");
    
    try {
      console.log("Fetching faucet status from:", `${this.remoteBackendUrl}/api/balance`);
      
      // Update connection status
      if (connectionStatus) {
        connectionStatus.textContent = "Fetching...";
        connectionStatus.className = "status-value fetching";
      }
      
      const response = await fetch(`${this.remoteBackendUrl}/api/balance`);
      
      if (response.ok) {
        const data = await response.json();
        console.log("Faucet status response:", JSON.stringify(data, null, 2));
        
        // Update connection status
        if (connectionStatus) {
          connectionStatus.textContent = "Connected";
          connectionStatus.className = "status-value connected";
        }
        
        // Update faucet address
        if (data.body && data.body.publicKey && faucetAddress) {
          const fullAddress = data.body.publicKey;
          const shortAddress = fullAddress.substring(0, 5) + "..." + fullAddress.substring(fullAddress.length - 5);
          faucetAddress.innerHTML = `<span class="clickable-address" title="Click to copy full address" data-address="${fullAddress}">${shortAddress}</span>`;
          
          // Add click-to-copy functionality
          const addressSpan = faucetAddress.querySelector('.clickable-address');
          if (addressSpan) {
            addressSpan.addEventListener('click', () => {
              navigator.clipboard.writeText(fullAddress).then(() => {
                console.log('Address copied to clipboard:', fullAddress);
                // Show temporary feedback
                const originalText = addressSpan.textContent;
                addressSpan.textContent = 'Copied!';
                setTimeout(() => {
                  addressSpan.textContent = originalText;
                }, 1000);
              }).catch(err => {
                console.error('Failed to copy address:', err);
              });
            });
          }
        }
        
        // Update balance
        if (data.body && data.body.balance && faucetBalance) {
          const balance = data.body.balance; // Raw balance as string
          console.log("Faucet balance:", balance);
          faucetBalance.textContent = balance;
          
          // Add visual indicator for low balance (checking if numeric value is low)
          const numericBalance = Number(balance);
          if (numericBalance < 1000000000000000000) { // Less than 1 unit in wei
            faucetBalance.className = "status-value low-balance";
          } else {
            faucetBalance.className = "status-value";
          }
        }
        
      } else {
        const errorData = await response.text();
        console.error("Failed to fetch faucet status:", response.status, errorData);
        
        if (connectionStatus) {
          connectionStatus.textContent = "Error";
          connectionStatus.className = "status-value error";
        }
        if (faucetBalance) {
          faucetBalance.textContent = "Unavailable";
        }
        if (faucetAddress) {
          faucetAddress.textContent = "Unavailable";
        }
      }
    } catch (error) {
      console.error("Error fetching faucet status:", error);
      
      if (connectionStatus) {
        connectionStatus.textContent = "Offline";
        connectionStatus.className = "status-value offline";
      }
      if (faucetBalance) {
        faucetBalance.textContent = "Connection error";
      }
      if (faucetAddress) {
        faucetAddress.textContent = "Connection error";
      }
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

  private async requestTokens(address: string): Promise<void> {
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

        // SECURITY: Amount is determined by server based on identity check
        const requestBody = { address };
        console.log("Sending request to backend:", {
          url: `${this.remoteBackendUrl}/api/request`,
          body: requestBody
        });

        let result = await fetch(`${this.remoteBackendUrl}/api/request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
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
          if (confirmationBlockElement && responseData.body.confirmationBlock && responseData.body.confirmationBlock !== -1) {
            confirmationBlockElement.textContent = responseData.body.confirmationBlock.toString();
          } else if (confirmationBlockElement) {
            confirmationBlockElement.textContent = "Pending confirmation";
          }
          transactionInfo.classList.remove("hidden");
        }

        // Show success message with the actual amount received from server
        const receivedAmount = responseData.body.amount || "tokens";
        this.showSuccess(`Successfully received ${receivedAmount} DEM!`);

        // Update balance after successful request
        await this.updateFaucetStatus();

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
