import "../styles/main.css";
class App {
  constructor() {
    this.init();
  }

  private init(): void {
    const app = document.getElementById("app");
    if (app) {
      //app.innerHTML = "<h1>TypeScript App Running!</h1>";
      //app.innerHTML += `<p>REMOTE_BACKEND_URL: ${process.env.REMOTE_BACKEND_URL}</p>`;
    }
  }

  private async getBalance(address: string): Promise<void> {
    // TODO: get balance from backend
  }

  private async requestTokens(address: string, amount: number): Promise<void> {
    // TODO: request tokens from backend
  }

  private async getTransactionHistory(address: string): Promise<void> {
    // TODO: get transaction history from backend
  }

  private async getTransactionStatus(txHash: string): Promise<void> {
    // TODO: get transaction status from backend
  }
}

new App();
