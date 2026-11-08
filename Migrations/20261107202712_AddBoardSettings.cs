using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class AddBoardSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BoardSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false),
                    AutoResetEnabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    AutoResetCheckedUtc = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BoardSettings", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "BoardSettings",
                columns: new[] { "Id", "AutoResetCheckedUtc", "AutoResetEnabled" },
                values: new object[] { 1, null, false });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BoardSettings");
        }
    }
}
