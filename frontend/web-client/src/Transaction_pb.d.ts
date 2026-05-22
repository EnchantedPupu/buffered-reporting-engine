import * as jspb from 'google-protobuf'

import * as google_protobuf_timestamp_pb from 'google-protobuf/google/protobuf/timestamp_pb'; // proto import: "google/protobuf/timestamp.proto"


export class ReportRequest extends jspb.Message {
  getClientId(): string;
  setClientId(value: string): ReportRequest;

  getBatchSize(): number;
  setBatchSize(value: number): ReportRequest;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ReportRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ReportRequest): ReportRequest.AsObject;
  static serializeBinaryToWriter(message: ReportRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ReportRequest;
  static deserializeBinaryFromReader(message: ReportRequest, reader: jspb.BinaryReader): ReportRequest;
}

export namespace ReportRequest {
  export type AsObject = {
    clientId: string;
    batchSize: number;
  };
}

export class TransactionResponse extends jspb.Message {
  getId(): string;
  setId(value: string): TransactionResponse;

  getCategory(): string;
  setCategory(value: string): TransactionResponse;

  getAmount(): number;
  setAmount(value: number): TransactionResponse;

  getCurrency(): string;
  setCurrency(value: string): TransactionResponse;

  getTimestamp(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setTimestamp(value?: google_protobuf_timestamp_pb.Timestamp): TransactionResponse;
  hasTimestamp(): boolean;
  clearTimestamp(): TransactionResponse;

  getStatus(): string;
  setStatus(value: string): TransactionResponse;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): TransactionResponse.AsObject;
  static toObject(includeInstance: boolean, msg: TransactionResponse): TransactionResponse.AsObject;
  static serializeBinaryToWriter(message: TransactionResponse, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): TransactionResponse;
  static deserializeBinaryFromReader(message: TransactionResponse, reader: jspb.BinaryReader): TransactionResponse;
}

export namespace TransactionResponse {
  export type AsObject = {
    id: string;
    category: string;
    amount: number;
    currency: string;
    timestamp?: google_protobuf_timestamp_pb.Timestamp.AsObject;
    status: string;
  };
}

