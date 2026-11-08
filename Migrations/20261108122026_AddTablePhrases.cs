using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class AddTablePhrases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TablePhrases",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Phrase = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    GameId = table.Column<int>(type: "INTEGER", nullable: true),
                    UserId = table.Column<string>(type: "TEXT", maxLength: 450, nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TablePhrases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TablePhrases_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TablePhrases_CreatedUtc",
                table: "TablePhrases",
                column: "CreatedUtc");

            migrationBuilder.CreateIndex(
                name: "IX_TablePhrases_GameId",
                table: "TablePhrases",
                column: "GameId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TablePhrases");
        }
    }
}
