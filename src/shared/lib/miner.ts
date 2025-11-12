import { Socket } from 'net';
import log from 'electron-log';
import { EventEmitter } from 'events';

/**
 * CPU Prime Miner for Nexus Interface
 * Implements the LLP (Lower Level Protocol) mining protocol with proper
 * channel handshake and auto-reconnect functionality.
 */

// Protocol packet types
enum PacketType {
  // Data packets
  BLOCK_DATA = 0,
  SUBMIT_BLOCK = 1,
  BLOCK_HEIGHT = 2,
  SET_CHANNEL = 3,

  // Request packets
  GET_BLOCK = 129,
  GET_HEIGHT = 130,
  GET_REWARD = 131,

  // Response packets
  GOOD = 200,
  FAIL = 201,

  // Generic
  PING = 253,
  CLOSE = 254,
}

// Connection states
enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  HANDSHAKING = 'handshaking', // Waiting for PING response after SET_CHANNEL
  READY = 'ready', // Channel confirmed, ready to mine
  MINING = 'mining',
  RECONNECTING = 'reconnecting',
}

interface MinerConfig {
  host: string;
  port: number;
  channel: number; // 1 for Prime channel, 2 for Hash channel
  timeout: number; // Connection timeout in seconds
  maxReconnectDelay: number; // Maximum delay between reconnect attempts in ms
  minReconnectDelay: number; // Minimum delay between reconnect attempts in ms
}

interface Packet {
  header: number;
  length: number;
  data: Buffer;
}

/**
 * CPU Prime Miner Client
 * Manages connection to Nexus Core mining server with proper handshake
 * and auto-reconnect functionality.
 */
export class PrimeMiner extends EventEmitter {
  private config: MinerConfig;
  private socket: Socket | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectDelay: number;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private connected: boolean = false;
  private shouldReconnect: boolean = true;
  private incomingBuffer: Buffer = Buffer.alloc(0);
  private blockHeight: number = 0;
  private blocksAccepted: number = 0;
  private blocksRejected: number = 0;
  private channelConfirmed: boolean = false;

  constructor(config: Partial<MinerConfig> = {}) {
    super();
    this.config = {
      host: config.host || '127.0.0.1',
      port: config.port || 9325,
      channel: config.channel || 1, // Default to Prime channel
      timeout: config.timeout || 30,
      maxReconnectDelay: config.maxReconnectDelay || 60000, // 60 seconds
      minReconnectDelay: config.minReconnectDelay || 1000, // 1 second
    };
    this.reconnectDelay = this.config.minReconnectDelay;
  }

  /**
   * Start the miner - connect and begin mining
   */
  public start(): void {
    log.info('[Miner] Starting CPU Prime miner...');
    this.shouldReconnect = true;
    this.connect();
  }

  /**
   * Stop the miner gracefully
   */
  public stop(): void {
    log.info('[Miner] Stopping CPU Prime miner...');
    this.shouldReconnect = false;
    this.clearTimers();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.setState(ConnectionState.DISCONNECTED);
  }

  /**
   * Get current miner stats
   */
  public getStats() {
    return {
      state: this.state,
      connected: this.connected,
      blockHeight: this.blockHeight,
      blocksAccepted: this.blocksAccepted,
      blocksRejected: this.blocksRejected,
      channel: this.config.channel,
    };
  }

  /**
   * Connect to the mining server
   */
  private connect(): void {
    if (this.socket) {
      this.socket.destroy();
    }

    this.setState(ConnectionState.CONNECTING);
    log.info(`[Miner] Connecting to ${this.config.host}:${this.config.port}...`);

    this.socket = new Socket();
    this.socket.setTimeout(this.config.timeout * 1000);

    // Socket event handlers
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('data', this.onData.bind(this));
    this.socket.on('error', this.onError.bind(this));
    this.socket.on('close', this.onClose.bind(this));
    this.socket.on('timeout', this.onTimeout.bind(this));

    this.socket.connect(this.config.port, this.config.host);
  }

  /**
   * Handle successful connection
   */
  private onConnect(): void {
    log.info('[Miner] Connected to mining server');
    this.connected = true;
    this.reconnectDelay = this.config.minReconnectDelay; // Reset backoff
    this.emit('connected');

    // Start channel handshake sequence
    this.startHandshake();
  }

  /**
   * Start the channel handshake sequence
   * 1. Send SET_CHANNEL
   * 2. Send PING as ordering barrier
   * 3. Wait for PING response
   * 4. Mark channel as confirmed
   */
  private startHandshake(): void {
    this.setState(ConnectionState.HANDSHAKING);
    this.channelConfirmed = false;

    log.info(`[Miner] Starting handshake - setting channel to ${this.config.channel}`);

    // Step 1: Send SET_CHANNEL
    this.sendSetChannel(this.config.channel);

    // Step 2: Send PING as ordering barrier
    // This ensures SET_CHANNEL is processed before any GET_REWARD/GET_BLOCK
    setTimeout(() => {
      log.info('[Miner] Sending PING as ordering barrier');
      this.sendPing();
    }, 100);

    // Set timeout for handshake
    this.handshakeTimer = setTimeout(() => {
      log.error('[Miner] Handshake timeout - no PING response received');
      this.handleConnectionError(new Error('Handshake timeout'));
    }, 5000);
  }

  /**
   * Complete handshake after PING response
   */
  private completeHandshake(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }

    this.channelConfirmed = true;
    this.setState(ConnectionState.READY);
    log.info('[Miner] Channel handshake complete - ready to mine');
    this.emit('ready');

    // Start mining operations
    this.startMining();
  }

  /**
   * Start mining operations
   */
  private startMining(): void {
    this.setState(ConnectionState.MINING);
    log.info('[Miner] Starting mining operations');

    // Request initial block height
    this.sendGetHeight();

    // Start heartbeat to keep connection alive
    this.startHeartbeat();
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // Check height every second and send ping periodically
    this.heartbeatTimer = setInterval(() => {
      if (this.state === ConnectionState.MINING) {
        this.sendGetHeight();
      }
    }, 1000);
  }

  /**
   * Handle incoming data
   */
  private onData(data: Buffer): void {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, data]);

    // Process complete packets
    while (this.processPacket()) {
      // Keep processing while we have complete packets
    }
  }

  /**
   * Process a single packet from the buffer
   * Returns true if a packet was processed, false if incomplete
   */
  private processPacket(): boolean {
    // Need at least 5 bytes for header + length
    if (this.incomingBuffer.length < 5) {
      return false;
    }

    const header = this.incomingBuffer.readUInt8(0);
    const length = this.incomingBuffer.readUInt32LE(1);

    // Check if we have the full packet
    if (this.incomingBuffer.length < 5 + length) {
      return false;
    }

    // Extract packet data
    const packetData = this.incomingBuffer.slice(5, 5 + length);
    
    // Remove processed packet from buffer
    this.incomingBuffer = this.incomingBuffer.slice(5 + length);

    // Handle the packet
    this.handlePacket({ header, length, data: packetData });

    return true;
  }

  /**
   * Handle a received packet
   */
  private handlePacket(packet: Packet): void {
    switch (packet.header) {
      case PacketType.PING:
        log.info('[Miner] Received PING response');
        if (this.state === ConnectionState.HANDSHAKING) {
          // PING response confirms channel was set
          this.completeHandshake();
        }
        break;

      case PacketType.BLOCK_HEIGHT:
        if (packet.length >= 4) {
          const newHeight = packet.data.readUInt32LE(0);
          if (newHeight > this.blockHeight) {
            this.blockHeight = newHeight;
            log.info(`[Miner] New block height: ${this.blockHeight}`);
            this.emit('block', this.blockHeight);
          }
        }
        break;

      case PacketType.BLOCK_DATA:
        log.info('[Miner] Received block data');
        this.emit('blockData', packet.data);
        break;

      case PacketType.GOOD:
        this.blocksAccepted++;
        log.info(`[Miner] Block ACCEPTED (total: ${this.blocksAccepted})`);
        this.emit('blockAccepted');
        break;

      case PacketType.FAIL:
        this.blocksRejected++;
        log.warn(`[Miner] Block REJECTED (total: ${this.blocksRejected})`);
        this.emit('blockRejected');
        break;

      case PacketType.CLOSE:
        log.info('[Miner] Server requested connection close');
        this.handleConnectionError(new Error('Server closed connection'));
        break;

      default:
        log.warn(`[Miner] Unknown packet type: ${packet.header}`);
    }
  }

  /**
   * Handle connection error
   */
  private onError(error: Error): void {
    log.error('[Miner] Connection error:', error.message);
    this.handleConnectionError(error);
  }

  /**
   * Handle connection timeout
   */
  private onTimeout(): void {
    log.error('[Miner] Connection timeout');
    this.handleConnectionError(new Error('Connection timeout'));
  }

  /**
   * Handle connection close
   */
  private onClose(hadError: boolean): void {
    log.info(`[Miner] Connection closed ${hadError ? 'with error' : 'cleanly'}`);
    this.connected = false;
    this.channelConfirmed = false;
    this.clearTimers();
    
    if (this.shouldReconnect) {
      this.scheduleReconnect();
    } else {
      this.setState(ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Handle connection errors and initiate reconnect
   */
  private handleConnectionError(error: Error): void {
    this.emit('error', error);
    
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    this.setState(ConnectionState.RECONNECTING);
    this.clearTimers();

    log.info(`[Miner] Scheduling reconnect in ${this.reconnectDelay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    // Increase delay for next time (exponential backoff)
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.config.maxReconnectDelay
    );

    this.emit('reconnecting', this.reconnectDelay);
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  /**
   * Set connection state and emit event
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      log.info(`[Miner] State changed to: ${state}`);
      this.emit('stateChange', state);
    }
  }

  /**
   * Send a packet to the server
   */
  private sendPacket(header: number, data?: Buffer): void {
    if (!this.socket || !this.connected) {
      log.warn('[Miner] Cannot send packet - not connected');
      return;
    }

    const length = data ? data.length : 0;
    const packet = Buffer.alloc(5 + length);
    
    packet.writeUInt8(header, 0);
    packet.writeUInt32LE(length, 1);
    
    if (data) {
      data.copy(packet, 5);
    }

    this.socket.write(packet);
  }

  /**
   * Send SET_CHANNEL packet
   */
  private sendSetChannel(channel: number): void {
    const data = Buffer.alloc(4);
    data.writeUInt32LE(channel, 0);
    this.sendPacket(PacketType.SET_CHANNEL, data);
    log.info(`[Miner] Sent SET_CHANNEL: ${channel}`);
  }

  /**
   * Send PING packet
   */
  private sendPing(): void {
    this.sendPacket(PacketType.PING);
  }

  /**
   * Send GET_HEIGHT packet
   */
  private sendGetHeight(): void {
    this.sendPacket(PacketType.GET_HEIGHT);
  }

  /**
   * Send GET_BLOCK packet
   */
  public sendGetBlock(): void {
    if (!this.channelConfirmed) {
      log.warn('[Miner] Cannot request block - channel not confirmed');
      return;
    }
    this.sendPacket(PacketType.GET_BLOCK);
    log.info('[Miner] Requested new block');
  }

  /**
   * Send GET_REWARD packet
   */
  public sendGetReward(): void {
    if (!this.channelConfirmed) {
      log.warn('[Miner] Cannot request reward - channel not confirmed');
      return;
    }
    this.sendPacket(PacketType.GET_REWARD);
    log.info('[Miner] Requested reward');
  }

  /**
   * Submit a block solution
   */
  public submitBlock(merkleRoot: Buffer, nonce: bigint): void {
    if (!this.channelConfirmed) {
      log.warn('[Miner] Cannot submit block - channel not confirmed');
      return;
    }

    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(nonce);

    const data = Buffer.concat([merkleRoot, nonceBuffer]);
    this.sendPacket(PacketType.SUBMIT_BLOCK, data);
    log.info('[Miner] Submitted block solution');
  }
}
