
import { Column, CreatedAt, DataType, Model, Sequelize, Table, UpdatedAt } from "sequelize-typescript";
import { IUser } from "./iuser.interface"; // Verifique o caminho

@Table({
    tableName: 'users',

})
export class UserEntity extends Model implements IUser {
    @Column({
        type: DataType.INTEGER,
        autoIncrement: true,
        primaryKey: true
    })
    id?: number;

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    name!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false,
        unique: true
    })
    email!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    password!: string;

    @Column({
        type: DataType.STRING(20),
        allowNull: false
    })
    cellPhone!: string;


    @CreatedAt
    @Column({
        type: DataType.DATE
    })
    createdAt?: Date;

    @UpdatedAt
    @Column({
        type: DataType.DATE
    })
    updatedAt?: Date;
}