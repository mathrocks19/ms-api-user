import 'dotenv/config';
import "./providers/databases";
import { app } from "./providers/messager-broker-access";

app.listen(() => console.log('Listen Messager broker is running...'));