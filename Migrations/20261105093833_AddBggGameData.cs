using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class AddBggGameData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GameTitle",
                table: "PlayTables",
                type: "TEXT",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BggId",
                table: "Games",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "YearPublished",
                table: "Games",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "GameAlternateNames",
                columns: table => new
                {
                    GameId = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GameAlternateNames", x => new { x.GameId, x.Name });
                    table.ForeignKey(
                        name: "FK_GameAlternateNames_Games_GameId",
                        column: x => x.GameId,
                        principalTable: "Games",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Games_BggId",
                table: "Games",
                column: "BggId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GameAlternateNames");

            migrationBuilder.DropIndex(
                name: "IX_Games_BggId",
                table: "Games");

            migrationBuilder.DropColumn(
                name: "GameTitle",
                table: "PlayTables");

            migrationBuilder.DropColumn(
                name: "BggId",
                table: "Games");

            migrationBuilder.DropColumn(
                name: "YearPublished",
                table: "Games");
        }
    }
}
