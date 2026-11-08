using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planszowkarz.Migrations
{
    /// <inheritdoc />
    public partial class AddTableCreatorAndKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CreatorUserId",
                table: "PlayTables",
                type: "TEXT",
                maxLength: 450,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "PlayTables",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Small");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatorUserId",
                table: "PlayTables");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "PlayTables");
        }
    }
}
