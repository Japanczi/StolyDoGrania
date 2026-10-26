using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class KatalogGierIStoly : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TableSlots_Tables_TableId",
                table: "TableSlots");

            migrationBuilder.DropPrimaryKey(
                name: "PK_Tables",
                table: "Tables");

            migrationBuilder.DropColumn(
                name: "BggUrl",
                table: "Tables");

            migrationBuilder.DropColumn(
                name: "Cover",
                table: "Tables");

            migrationBuilder.DropColumn(
                name: "CoverContentType",
                table: "Tables");

            migrationBuilder.DropColumn(
                name: "Difficulty",
                table: "Tables");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "Tables");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "Tables");

            migrationBuilder.RenameTable(
                name: "Tables",
                newName: "PlayTables");

            migrationBuilder.RenameColumn(
                name: "TableId",
                table: "TableSlots",
                newName: "PlayTableId");

            migrationBuilder.RenameColumn(
                name: "Id",
                table: "PlayTables",
                newName: "TableId");

            migrationBuilder.AddColumn<int>(
                name: "GameId",
                table: "PlayTables",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddPrimaryKey(
                name: "PK_PlayTables",
                table: "PlayTables",
                column: "TableId");

            migrationBuilder.CreateTable(
                name: "Games",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Difficulty = table.Column<decimal>(type: "TEXT", precision: 3, scale: 2, nullable: false),
                    MaxPlayers = table.Column<int>(type: "INTEGER", nullable: false),
                    BggUrl = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    Cover = table.Column<byte[]>(type: "BLOB", nullable: true),
                    CoverContentType = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Games", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlayTables_GameId",
                table: "PlayTables",
                column: "GameId");

            migrationBuilder.CreateIndex(
                name: "IX_Games_Name",
                table: "Games",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayTables_Games_GameId",
                table: "PlayTables",
                column: "GameId",
                principalTable: "Games",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_TableSlots_PlayTables_PlayTableId",
                table: "TableSlots",
                column: "PlayTableId",
                principalTable: "PlayTables",
                principalColumn: "TableId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PlayTables_Games_GameId",
                table: "PlayTables");

            migrationBuilder.DropForeignKey(
                name: "FK_TableSlots_PlayTables_PlayTableId",
                table: "TableSlots");

            migrationBuilder.DropTable(
                name: "Games");

            migrationBuilder.DropPrimaryKey(
                name: "PK_PlayTables",
                table: "PlayTables");

            migrationBuilder.DropIndex(
                name: "IX_PlayTables_GameId",
                table: "PlayTables");

            migrationBuilder.DropColumn(
                name: "GameId",
                table: "PlayTables");

            migrationBuilder.RenameTable(
                name: "PlayTables",
                newName: "Tables");

            migrationBuilder.RenameColumn(
                name: "PlayTableId",
                table: "TableSlots",
                newName: "TableId");

            migrationBuilder.RenameColumn(
                name: "TableId",
                table: "Tables",
                newName: "Id");

            migrationBuilder.AddColumn<string>(
                name: "BggUrl",
                table: "Tables",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "Cover",
                table: "Tables",
                type: "BLOB",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoverContentType",
                table: "Tables",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Difficulty",
                table: "Tables",
                type: "TEXT",
                precision: 3,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "Tables",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "Tables",
                type: "TEXT",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Tables",
                table: "Tables",
                column: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_TableSlots_Tables_TableId",
                table: "TableSlots",
                column: "TableId",
                principalTable: "Tables",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
