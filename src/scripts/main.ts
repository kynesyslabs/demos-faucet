import "../styles/main.css";
class App {
  public remoteBackendUrl: string;

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

  private init(): void {
    const app = document.getElementById("app");
    if (app) {
      //app.innerHTML = "<h1>TypeScript App Running!</h1>";
      //app.innerHTML += `<p>REMOTE_BACKEND_URL: ${process.env.REMOTE_BACKEND_URL}</p>`;
      // TODO Balance display
    }

    // Faucet form and its event listener
    const faucetForm = document.getElementById("faucet-form");
    if (faucetForm) {
      faucetForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const address = document.getElementById(
          "wallet-address"
        ) as HTMLInputElement;
        this.requestTokens(address.value, 1000);
      });
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

    if (submitButton && buttonText) {
      // Show loading state
      submitButton.classList.add("loading");
      buttonText.innerHTML = '<span class="spinner"></span>Processing...';

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

        if (!result.ok) {
          const errorData = await result.json().catch(() => ({}));
          throw new Error(
            errorData.message || `Server returned ${result.status}`
          );
        }

        buttonText.textContent = "Success!";
        setTimeout(() => {
          buttonText.textContent = "Request Tokens";
          submitButton.classList.remove("loading");
        }, 10000); // 10 seconds
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
