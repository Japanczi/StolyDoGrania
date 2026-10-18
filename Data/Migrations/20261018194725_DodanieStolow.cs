using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class DodanieStolow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Tables",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Start = table.Column<DateTime>(type: "TEXT", nullable: false),
                    MaxPlayers = table.Column<int>(type: "INTEGER", nullable: false),
                    BggUrl = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    Difficulty = table.Column<decimal>(type: "TEXT", precision: 3, scale: 2, nullable: false),
                    Cover = table.Column<byte[]>(type: "BLOB", nullable: true),
                    CoverContentType = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    TakenSlots = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tables", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TableSlots",
                columns: table => new
                {
                    TableId = table.Column<int>(type: "INTEGER", nullable: false),
                    SlotNumber = table.Column<int>(type: "INTEGER", nullable: false),
                    ParticipantName = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TableSlots", x => new { x.TableId, x.SlotNumber });
                    table.ForeignKey(
                        name: "FK_TableSlots_Tables_TableId",
                        column: x => x.TableId,
                        principalTable: "Tables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TableSlots");

            migrationBuilder.DropTable(
                name: "Tables");
        }
    }
}
