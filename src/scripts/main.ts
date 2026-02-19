class App {
  public remoteBackendUrl: string;
  private tiltEnabled: boolean = true;

  constructor() {
    this.remoteBackendUrl = (window as any).__BACKEND_URL__ ?? 
                           "http://backend:3010";
    console.log("Using backend URL:", this.remoteBackendUrl);
    this.testBackendUrl();
    this.init();
    this.initTiltEffect();
  }

  private initTiltEffect(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.tiltEnabled = false;
      return;
    }

    const card = document.querySelector('.faucet-card') as HTMLElement;
    const shine = document.querySelector('.faucet-card .shine') as HTMLElement;
    if (!card) return;

    card.classList.add('tilt-active');

    const handleMove = (e: MouseEvent) => {
      if (!this.tiltEnabled) return;

      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const mouseX = e.clientX - centerX;
      const mouseY = e.clientY - centerY;
      
      const maxTilt = 4;
      const tiltY = (mouseX / (rect.width / 2)) * maxTilt;
      const tiltX = -((mouseY / (rect.height / 2)) * maxTilt);
      
      card.style.setProperty('--tilt-x', `${tiltX}deg`);
      card.style.setProperty('--tilt-y', `${tiltY}deg`);

      if (shine) {
        const shineX = ((e.clientX - rect.left) / rect.width) * 100;
        const shineY = ((e.clientY - rect.top) / rect.height) * 100;
        shine.style.setProperty('--shine-x', `${shineX}%`);
        shine.style.setProperty('--shine-y', `${shineY}%`);
      }
    };

    const handleLeave = () => {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    };

    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', handleLeave);
  }

  private async testBackendUrl(): Promise<void> {
    if (!this.remoteBackendUrl) {
      console.error("REMOTE_BACKEND_URL is not set");
      return;
    }
    console.log("Testing REMOTE_BACKEND_URL: " + this.remoteBackendUrl);
    try {
      const result = await fetch(`${this.remoteBackendUrl}/api/test`, {
        signal: AbortSignal.timeout(5000)
      });
      if (result.ok) {
        console.log("REMOTE_BACKEND_URL is working");
      } else {
        console.error("[ERROR] REMOTE_BACKEND_URL returned:", result.status);
      }
    } catch (error) {
      console.error("[ERROR] REMOTE_BACKEND_URL test failed:", error);
    }
  }

  private async init(): Promise<void> {
    await this.updateFaucetStatus();

    setInterval(() => {
      this.updateFaucetStatus();
    }, 30000);

    this.initInputAnimations();
    this.initButtonRipple();

    const faucetForm = document.getElementById("faucet-form");
    if (faucetForm) {
      faucetForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const addressInput = document.getElementById("wallet-address") as HTMLInputElement;
        const inputGroup = addressInput?.closest('.input-group');
        const address = addressInput?.value.trim();

        if (!address) {
          inputGroup?.classList.add('invalid');
          addressInput?.setAttribute('aria-invalid', 'true');
          this.showError("Please enter a wallet address");
          addressInput?.focus();
          setTimeout(() => {
            inputGroup?.classList.remove('invalid');
            addressInput?.setAttribute('aria-invalid', 'false');
          }, 500);
          return;
        }

        if (!this.isValidAddress(address)) {
          inputGroup?.classList.add('invalid');
          addressInput?.setAttribute('aria-invalid', 'true');
          this.showError("Invalid address format. Expected 0x followed by 64 hex characters.");
          addressInput?.focus();
          setTimeout(() => {
            inputGroup?.classList.remove('invalid');
            addressInput?.setAttribute('aria-invalid', 'false');
          }, 500);
          return;
        }

        inputGroup?.classList.remove('invalid');
        addressInput?.setAttribute('aria-invalid', 'false');
        inputGroup?.classList.add('valid');
        this.requestTokens(address);
      });
    }
  }

  private initInputAnimations(): void {
    const addressInput = document.getElementById("wallet-address") as HTMLInputElement;
    const inputGroup = addressInput?.closest('.input-group') as HTMLElement;
    
    if (!addressInput || !inputGroup) return;

    let typingTimeout: ReturnType<typeof setTimeout>;
    
    addressInput.addEventListener('input', () => {
      inputGroup.classList.add('typing');
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        inputGroup.classList.remove('typing');
      }, 150);

      const value = addressInput.value.trim();
      if (value && this.isValidAddress(value)) {
        inputGroup.classList.remove('invalid');
        inputGroup.classList.add('valid');
      } else if (value) {
        inputGroup.classList.remove('valid');
      } else {
        inputGroup.classList.remove('valid', 'invalid');
      }
    });

    addressInput.addEventListener('blur', () => {
      inputGroup.classList.remove('typing');
    });
  }

  private initButtonRipple(): void {
    const button = document.querySelector('.request-button') as HTMLButtonElement;
    if (!button) return;

    button.addEventListener('click', (e) => {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ripple = document.createElement('span');
      ripple.className = 'button-ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;

      button.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
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
          const balance = data.body.balance;
          console.log("Faucet balance:", balance);
          faucetBalance.textContent = this.formatBalance(balance);
          
          const numericBalance = Number(balance);
          if (numericBalance < 1000000000000000000) {
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

  private createSafeLink(text: string, href: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  private formatBalance(rawBalance: string): string {
    const num = BigInt(rawBalance || '0');
    const divisor = BigInt('1000000000000000000');
    const whole = num / divisor;
    const remainder = num % divisor;
    const decimal = (remainder * BigInt(10000)) / divisor;
    const decimalStr = decimal.toString().padStart(4, '0').slice(0, 2);
    return `${whole}.${decimalStr} DEMOS`;
  }

  private isValidAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(address);
  }

  private showSuccess(message: string): void {
    const messageContainer = document.getElementById("message-container");
    const messageCard = messageContainer?.querySelector(".message-card");
    const messageContent = document.getElementById("message-content");
    const messageTitle = document.getElementById("message-title");

    if (messageContainer && messageCard && messageContent) {
      messageCard.classList.remove("error");
      messageCard.classList.add("success");
      messageContent.textContent = message;
      if (messageTitle) messageTitle.textContent = "Success";
      messageContainer.classList.remove("hidden");
    }
  }

  private showError(message: string): void {
    const messageContainer = document.getElementById("message-container");
    const messageCard = messageContainer?.querySelector(".message-card");
    const messageContent = document.getElementById("message-content");
    const messageTitle = document.getElementById("message-title");

    if (messageContainer && messageCard && messageContent) {
      messageCard.classList.remove("success");
      messageCard.classList.add("error");
      messageContent.textContent = message;
      if (messageTitle) messageTitle.textContent = "Error";
      messageContainer.classList.remove("hidden");
    }
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
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
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
          const body = responseData?.body;
        if (typeof body === 'string' && body.includes("exceeds maximum allowed amount")) {
            this.showError(
              "Requested amount exceeds the maximum allowed limit"
            );
          } else if (typeof body === 'string' && body.includes("maximum number of requests")) {
            this.showError(
              "You have reached the maximum number of requests for this time period"
            );
          } else if (typeof body === 'string' && body.includes("would exceed the maximum amount limit")) {
            this.showError(
              "This request would exceed your total amount limit for this time period"
            );
          } else {
            this.showError(
              body || `Server returned ${result.status}`
            );
          }
          throw new Error(
            body || `Server returned ${result.status}`
          );
        }

        // Show transaction info
        const transactionInfo = document.getElementById("transaction-info");
        const txHashElement = document.getElementById("tx-hash");
        const confirmationBlockElement = document.getElementById("confirmation-block");

        if (transactionInfo && txHashElement) {
          txHashElement.textContent = '';
          const txHash = responseData.body.txHash;
          const shortHash = `${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`;
          const link = this.createSafeLink(shortHash, `https://explorer.demos.sh/transactions/${txHash}`);
          link.style.color = 'var(--accent-primary)';
          txHashElement.appendChild(link);
          
          if (confirmationBlockElement && responseData.body.confirmationBlock && responseData.body.confirmationBlock !== -1) {
            confirmationBlockElement.textContent = `#${responseData.body.confirmationBlock}`;
          } else if (confirmationBlockElement) {
            confirmationBlockElement.textContent = "Pending...";
          }
          transactionInfo.classList.remove("hidden");
        }

        // Show success message with the actual amount received from server
        const receivedAmount = responseData.body?.amount;
        this.showSuccess(
          receivedAmount !== null && receivedAmount !== undefined
            ? `Successfully received ${receivedAmount} DEMOS!`
            : "Successfully received tokens!"
        );

        await this.updateFaucetStatus();

        submitButton.classList.add("success");
        buttonText.textContent = "Success!";
        
        setTimeout(() => {
          buttonText.textContent = "Request Tokens";
          submitButton.disabled = false;
          submitButton.removeAttribute('aria-busy');
          submitButton.classList.remove("loading", "success");
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
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.classList.remove("loading");
        console.error("Error requesting tokens:", error);
      }
    }
  }
}

new App();
