
import 'dotenv/config'; // Importa no topo para garantir que process.env esteja populado
import { Sequelize } from "sequelize-typescript";
import { UserEntity } from "../../../models/user/user.entity"; // Ajuste o caminho se necessário

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = parseInt(process.env.DB_PORT || '3306', 10); // Default MySQL port
const dbUser = process.env.DB_USER; // Sem default, deve vir do .env
const dbPass = process.env.DB_PASS; // Sem default, deve vir do .env
const dbName = process.env.DB_NAME; // Sem default, deve vir do .env
const dbDialect = process.env.DB_DIALECT as any || 'mysql'; // Default MySQL

// Validação básica das variáveis de ambiente
if (!dbUser || !dbPass || !dbName) {
    console.error("!!! [DB Error] Variáveis de ambiente DB_USER, DB_PASS ou DB_NAME não definidas no .env! Verifique o arquivo .env na raiz do ms-api-user.");
    // Considerar lançar um erro ou sair, pois a conexão falhará.
    // throw new Error("Variáveis de ambiente do banco de dados ausentes.");
}

console.log(`>>> [DB] Configurando conexão: host=${dbHost}, port=${dbPort}, user=${dbUser}, db=${dbName}, dialect=${dbDialect}`);

const sequelizeConnection = new Sequelize({
    host: dbHost,
    port: dbPort,
    database: dbName,
    dialect: dbDialect, // <-- 'mysql' virá do .env
    username: dbUser,
    password: dbPass,
    logging: (msg) => console.log(`[DB Log] ${msg}`), // Log SQL (ou false)
    pool: {
        max: 5,
        min: 1,
        acquire: 30000,
        idle: 10000
    },
    models: [UserEntity], // Carrega seu modelo UserEntity
    define: {
        timestamps: true, // Habilita createdAt e updatedAt
        // underscored: true, // Descomente se quiser que Sequelize use snake_case para tabelas/colunas no DB
    }
});

// Função assíncrona para autenticar e sincronizar
async function initializeDatabase() {
    try {
        await sequelizeConnection.authenticate();
        console.log('>>> [DB] Conexão com o banco de dados MySQL estabelecida com sucesso.');

        // Sincroniza os modelos (cria tabela 'users' se não existir)
        // ATENÇÃO: sync() em produção deve ser substituído por migrations.
        await sequelizeConnection.sync();
        console.log('>>> [DB] Modelos sincronizados com o banco de dados.');

    } catch (error) {
        console.error('!!! [DB] Não foi possível conectar ou sincronizar o banco de dados MySQL:', error);

    }
}

// Chama a inicialização. Outras partes da aplicação podem precisar esperar por isso.
initializeDatabase();

// Exporta a conexão para ser usada em outros lugares (ex: repositories)
export { sequelizeConnection };