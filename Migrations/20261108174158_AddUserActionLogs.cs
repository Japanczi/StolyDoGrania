using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planszowkarz.Migrations
{
    /// <inheritdoc />
    public partial class AddUserActionLogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserActionLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CreatedUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Action = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    ActorUserId = table.Column<string>(type: "TEXT", maxLength: 450, nullable: true),
                    ActorName = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    TargetUserId = table.Column<string>(type: "TEXT", maxLength: 450, nullable: true),
                    TargetName = table.Column<string>(type: "TEXT", maxLength: 256, nullable: true),
                    PlayTableId = table.Column<int>(type: "INTEGER", nullable: true),
                    Details = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserActionLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserActionLogs_CreatedUtc",
                table: "UserActionLogs",
                column: "CreatedUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserActionLogs");
        }
    }
}
