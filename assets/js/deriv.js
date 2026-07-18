window.DerivClient = class DerivClient {
  constructor({ onStatus, onTick, onAuthorize, onBalance, onProposal, onBuy, onContract, onError }) {
    Object.assign(this, { onStatus, onTick, onAuthorize, onBalance, onProposal, onBuy, onContract, onError });
    this.requestId = 1;
    this.ws = null;
  }

  connect(token) {
    this.close();
    this.token = token;
    this.onStatus('Connecting…');
    this.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    this.ws.onopen = () => this.send({ authorize: token });
    this.ws.onerror = () => this.onError('Unable to reach Deriv. Check your connection and try again.');
    this.ws.onclose = () => this.onStatus('Disconnected');
    this.ws.onmessage = event => this.handle(JSON.parse(event.data));
  }

  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; }
  send(message) { if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Deriv is not connected.'); this.ws.send(JSON.stringify({ ...message, req_id: this.requestId++ })); }
  subscribe(symbol) { this.send({ forget_all: 'ticks' }); this.send({ ticks: symbol, subscribe: 1 }); }
  proposal({ symbol, amount, currency, contractType, barrier }) { this.send({ proposal: 1, amount: String(amount), basis: 'stake', contract_type: contractType, currency, duration: 1, duration_unit: 't', symbol, barrier: String(barrier) }); }
  buy(proposalId, price) { this.send({ buy: proposalId, price }); }
  track(contractId) { this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }); }

  handle(data) {
    if (data.error) { this.onError(data.error.message || 'Deriv returned an error.'); return; }
    if (data.msg_type === 'authorize') { this.onAuthorize(data.authorize); this.onStatus(`Connected · ${data.authorize.loginid}`); this.send({ balance: 1, subscribe: 1 }); return; }
    if (data.msg_type === 'balance') { this.onBalance(data.balance); return; }
    if (data.msg_type === 'tick') { this.onTick(data.tick); return; }
    if (data.msg_type === 'proposal') { this.onProposal(data.proposal); return; }
    if (data.msg_type === 'buy') { this.onBuy(data.buy); return; }
    if (data.msg_type === 'proposal_open_contract') this.onContract(data.proposal_open_contract);
  }
};
