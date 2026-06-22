export interface ESP32State {
  relays: boolean[];
  variation: number; // 0, 1, 2
  delay: number; // 50 to 500
  dht: {
    temperature: number;
    humidity: number;
  };
}
