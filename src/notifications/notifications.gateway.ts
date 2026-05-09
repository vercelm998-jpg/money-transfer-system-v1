import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedUsers = new Map<number, string[]>();

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId;
    if (userId) {
      const id = Number(userId);
      const sockets = this.connectedUsers.get(id) || [];
      sockets.push(client.id);
      this.connectedUsers.set(id, sockets);
      this.logger.log(`🟢 User ${userId} connected (${sockets.length} sessions)`);
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedUsers.forEach((sockets, userId) => {
      const index = sockets.indexOf(client.id);
      if (index !== -1) {
        sockets.splice(index, 1);
        if (sockets.length === 0) {
          this.connectedUsers.delete(userId);
        }
        this.logger.log(`🔴 User ${userId} disconnected`);
      }
    });
  }

  // إرسال إشعار لمستخدم محدد
  sendNotificationToUser(userId: number, notification: any) {
    const sockets = this.connectedUsers.get(userId) || [];
    sockets.forEach(socketId => {
      this.server.to(socketId).emit('newNotification', notification);
    });
    this.logger.log(`📨 Notification sent to user ${userId}`);
  }

  // إرسال لجميع المستخدمين
  sendToAll(event: string, data: any) {
    this.server.emit(event, data);
  }
}