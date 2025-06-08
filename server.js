import { randomUUID } from "node:crypto";
import http from "node:http";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import pino from "pino";
import pinoPretty from "pino-pretty";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const logger = pino(pinoPretty());

app.use(cors());
app.use(
  bodyParser.json({
    type(req) {
      return true;
    },
  })
);
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Chat backend is running!",
  });
});

const userState = [];

app.post("/new-user", async (request, response) => {
  if (Object.keys(request.body).length === 0) {
    const result = {
      status: "error",
      message: "This name is already taken!",
    };
    response.status(400).send(JSON.stringify(result)).end();
    return;
  }

  const { name } = request.body;
  const isExist = userState.find((user) => user.name.toLowerCase() === name.toLowerCase());
  
  if (!isExist) {
    const newUser = {
      id: randomUUID(),
      name: name,
    };
    userState.push(newUser);
    const result = {
      status: "ok",
      user: newUser,
    };
    logger.info(`New user created: ${JSON.stringify(newUser)}`);
    response.send(JSON.stringify(result)).end();
  } else {
    const result = {
      status: "error",
      message: "This name is already taken!",
    };
    logger.error(`User with name "${name}" already exists`);
    response.status(409).send(JSON.stringify(result)).end();
  }
});

const server = http.createServer(app);
const wsServer = new WebSocketServer({ server });

function broadcastUsersList() {
  const message = JSON.stringify({
    type: "users-list",
    users: userState
  });
  
  wsServer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wsServer.on("connection", (ws) => {
  ws.send(JSON.stringify({
    type: "users-list",
    users: userState
  }));

  ws.on("message", (msg, isBinary) => {
    try {
      const receivedMSG = JSON.parse(msg);
      logger.info(`Message received: ${JSON.stringify(receivedMSG)}`);

      if (receivedMSG.type === "new-user") {
        const isExist = userState.find(user => 
          user.name.toLowerCase() === receivedMSG.user.name.toLowerCase()
        );
        
        if (!isExist) {
          userState.push(receivedMSG.user);
          broadcastUsersList();
        } else {
          ws.send(JSON.stringify({
            type: "nickname-error",
            message: "Этот никнейм уже занят"
          }));
        }
      } 
      else if (receivedMSG.type === "exit") {
        const idx = userState.findIndex(user => 
          user.name.toLowerCase() === receivedMSG.user.name.toLowerCase()
        );
        if (idx !== -1) {
          userState.splice(idx, 1);
          broadcastUsersList();
          logger.info(`User "${receivedMSG.user.name}" left the chat`);
        }
      } 
      else if (receivedMSG.type === "get-users") {
        ws.send(JSON.stringify({
          type: "users-list",
          users: userState
        }));
      } 
      else if (receivedMSG.type === "send") {
        wsServer.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg, { binary: isBinary });
          }
        });
        logger.info("Message broadcasted to all users");
      }
    } catch (e) {
      logger.error(`Error processing message: ${e.message}`);
    }
  });

  ws.on("close", () => {
    logger.info("Client disconnected");
  });
});

const port = process.env.PORT || 3000;

const bootstrap = async () => {
  try {
    server.listen(port, () =>
      logger.info(`Server is running on http://localhost:${port}`)
    );
  } catch (error) {
    logger.error(`Server error: ${error.message}`);
    process.exit(1);
  }
};

bootstrap();