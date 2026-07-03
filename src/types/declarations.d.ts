declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, bitrate: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
    flush(): Uint8Array;
  }
  export class WavHeader {
    static readHeader(dataView: DataView): { sampleRate: number; channels: number; samples: number };
  }
}