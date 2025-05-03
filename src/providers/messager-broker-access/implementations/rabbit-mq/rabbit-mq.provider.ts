import amqp from "amqplib";
import { v4 as uuidv4 } from 'uuid';
import { ErroCustom } from "../../../../errors/error-custom";
import { IMessagerAccess, IMessagerAccessRequest, IMessagerBrokerAccess, IResponseAccessResponse } from "../imessager-broker-access.interface";

export class RabbitMQ implements IMessagerBrokerAccess {

    private url: string = 'amqp://guest:guest@localhost:5672';

    private async connectAndGetChannel(): Promise<amqp.Channel> {
        try {
            const conn = await amqp.connect(this.url);
            const channel = await conn.createChannel();
            return channel;
        } catch (error) {
            console.error(`!!! [RabbitMQ - Simples] Falha ao conectar/criar canal:`, error);
            throw error;
        }
    }

    private async connectForSend(): Promise<{ conn: amqp.Connection, channel: amqp.Channel }> {
        let conn: amqp.Connection | null = null;
        try {
            conn = await amqp.connect(this.url);
            const channel = await conn.createChannel();
            return { conn, channel };
        } catch (error) {
            console.error(`!!! [RabbitMQ - Simples] Falha ao conectar/criar canal para envio:`, error);
            if (conn) await conn.close().catch(()=>{});
            throw error;
        }
    }

    public async connect(): Promise<amqp.Channel> {
        return this.connectAndGetChannel();
    }

    async createQueue(channel: amqp.Channel, queue: string): Promise<void> {
        try {
            await channel.assertQueue(queue, { durable: true });
        } catch (err) {
            console.error(`!!! [RabbitMQ - Simples] Erro ao garantir fila '${queue}':`, err);
            throw err;
        }
    }

    listenRPC(queue: string, callback: (req: IMessagerAccessRequest) => Promise<IResponseAccessResponse>) {
        this.connectAndGetChannel()
            .then(async (ch) => {
                await this.createQueue(ch, queue);
                console.log(`>>> [RabbitMQ - User] Aguardando mensagens (RPC) na fila '${queue}'`);
                ch.prefetch(1);
                ch.consume(queue, async (msg) => {
                    if (msg !== null) {
                        let response: IResponseAccessResponse | null = null;
                        const request = this.messageConvertRequest(msg);
                        try {
                            response = await callback(request);
                        } catch (err: any) {
                            console.error(`!!! [RabbitMQ - User] Erro ao processar mensagem RPC (CorrID: ${msg.properties.correlationId}):`, err);
                            if (err instanceof ErroCustom) { try { const error = JSON.parse(err.message); response = { code: error.code || 400, response: { message: error.error || 'Erro' } }; } catch { response = { code: 500, response: { message: 'Erro ao parsear ErroCustom' } };}} else { response = { code: 500, response: { message: 'Erro interno no servidor.' } }; }
                        }
                        if (msg.properties.replyTo && msg.properties.correlationId && response) {
                            await this.responseCallRPC({
                                queue: queue,
                                replyTo: msg.properties.replyTo,
                                correlationId: msg.properties.correlationId,
                                response: response
                            });
                        } else {
                            console.warn(`!!! [RabbitMQ - User] Mensagem na fila ${queue} sem replyTo/correlationId ou resposta nula. Não respondendo.`);
                        }
                        ch.ack(msg);
                    }
                }, { noAck: false });
            })
            .catch(err => console.error(`!!! [RabbitMQ - User] Erro ao iniciar listener RPC para ${queue}:`, err));
    }

    async sendPubSub(message: IMessagerAccess): Promise<void> {
        let connection: amqp.Connection | null = null;
        let channel: amqp.Channel | null = null;
        try {
            const connAndChannel = await this.connectForSend();
            connection = connAndChannel.conn;
            channel = connAndChannel.channel;
            await this.createQueue(channel, message.queue);
            channel.sendToQueue(
                message.queue,
                Buffer.from(JSON.stringify(message.message)),
                { persistent: true }
            );
            console.log(`>>> [RabbitMQ - User] Mensagem Pub/Sub enviada para '${message.queue}'.`);
        } catch (err) {
            console.error(`!!! [RabbitMQ - User] Erro ao enviar Pub/Sub para '${message.queue}':`, err);
            throw err;
        }
        finally {
            if (channel) await channel.close().catch(()=>{});
            if (connection) await connection.close().catch(()=>{});
        }
    }

    async sendRPC(message: IMessagerAccess): Promise<IResponseAccessResponse> {
        const timeout = 5000;
        let conn: amqp.Connection | null = null;
        let ch: amqp.Channel | null = null;
        return new Promise(async (resolve, reject) => {
            let isRespond = false; const corr = uuidv4(); let consumeTag: string | undefined; let timeoutHandle: NodeJS.Timeout | null = null;
            try {
                const connAndChannel = await this.connectForSend(); conn = connAndChannel.conn; ch = connAndChannel.channel;
                await this.createQueue(ch, message.queue);
                const q = await ch.assertQueue('', { exclusive: true, autoDelete: true });
                timeoutHandle = setTimeout(() => { if (!isRespond) { isRespond = true; if(ch && consumeTag) ch.cancel(consumeTag).catch(()=>{}); conn?.close().catch(() => {}); resolve({ code: 408, response: { message: 'Timeout' } }); }}, timeout);
                const { consumerTag: tag } = await ch.consume(q.queue, (msg: any) => { if (!isRespond && msg?.properties.correlationId === corr) { isRespond = true; if(timeoutHandle) clearTimeout(timeoutHandle); const messageResponse = this.messageConvert(msg); setTimeout(() => { conn?.close().catch(()=>{}); }, 500); resolve(messageResponse); }}, { noAck: true });
                consumeTag = tag;
                ch.sendToQueue(
                    message.queue,
                    Buffer.from(JSON.stringify(message.message)),
                    { correlationId: corr, replyTo: q.queue }
                );
            } catch (error) {
                console.error("!!! Erro no sendRPC:", error);
                if (!isRespond) { if(timeoutHandle) clearTimeout(timeoutHandle); if(ch && consumeTag) ch.cancel(consumeTag).catch(()=>{}); conn?.close().catch(()=>{}); reject(error); }
            }
        });
    }

    messageConvert(message: any): IResponseAccessResponse {
        const messageResponse: IResponseAccessResponse = { code: 200, response: { message: 'Ok' } };
        let result = null;
        try {
            result = JSON.parse(message.content.toString());
            if (typeof result === 'object' && result !== null && typeof result.code === 'number' && result.response !== undefined) {
                messageResponse.code = result.code;
                messageResponse.response = result.response;
            } else {
                messageResponse.response = result;
            }
        } catch (e) {
            messageResponse.code = 500;
            messageResponse.response = { message: 'Erro ao parsear resposta', raw: message.content.toString() };
        }
        return messageResponse;
    }

    messageConvertRequest(message: any): IMessagerAccessRequest {
        const messageRequest: IMessagerAccessRequest = { body: null, message: '' };
        try {
            messageRequest.body = JSON.parse(message.content.toString());
        } catch (e) {
            messageRequest.message = message.content.toString();
            messageRequest.body = { rawMessage: messageRequest.message };
        }
        return messageRequest;
    }

    async responseCallRPC(objResponse: { queue: string, replyTo: string, correlationId: string, response: IResponseAccessResponse }): Promise<void> {
        let connection: amqp.Connection | null = null;
        let channel: amqp.Channel | null = null;
        try {
            console.log(`>>> [User RPC Reply] Tentando enviar resposta para fila: ${objResponse.replyTo} (CorrID: ${objResponse.correlationId}) Payload:`, JSON.stringify(objResponse.response));
            const connAndChannel = await this.connectForSend(); connection = connAndChannel.conn; channel = connAndChannel.channel;
            channel.sendToQueue(
                objResponse.replyTo,
                Buffer.from(JSON.stringify(objResponse.response)),
                { correlationId: objResponse.correlationId }
            );
            console.log(`>>> [User RPC Reply] Resposta enviada para ${objResponse.replyTo}`);
        } catch (err) {
            console.error(`!!! [User RPC Reply] Erro ao enviar resposta para ${objResponse.replyTo}:`, err);
        }
        finally {
            if (channel) await channel.close().catch(()=>{});
            if (connection) await connection.close().catch(()=>{});
        }
    }

    listenPubSub(queue: string, callback: (req: IMessagerAccessRequest) => Promise<void>): void {
        this.connectAndGetChannel()
            .then(async (ch) => {
                await this.createQueue(ch, queue);
                console.log(`>>> [RabbitMQ - User] Aguardando mensagens (Pub/Sub - não usado) na fila '${queue}'`);
                ch.consume(queue, async (msg) => {
                    if (msg !== null) {
                        const request = this.messageConvertRequest(msg);
                        try {
                            await callback(request);
                            ch.ack(msg);
                        } catch (error) {
                            console.error(`!!! [RabbitMQ - User] Erro ao processar mensagem Pub/Sub (não usado):`, error);
                            ch.nack(msg, false, false);
                        }
                    }
                }, { noAck: false });
            })
            .catch(err => console.error(`!!! [RabbitMQ - User] Erro ao iniciar listener Pub/Sub (não usado) para ${queue}:`, err));
    }
}