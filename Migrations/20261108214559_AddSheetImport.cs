using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planszowkarz.Migrations
{
    /// <inheritdoc />
    public partial class AddSheetImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsImported",
                table: "TableSlots",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ImportKey",
                table: "PlayTables",
                type: "TEXT",
                maxLength: 220,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsFromSheet",
                table: "Games",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_PlayTables_ImportKey",
                table: "PlayTables",
                column: "ImportKey",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayTables_ImportKey",
                table: "PlayTables");

            migrationBuilder.DropColumn(
                name: "IsImported",
                table: "TableSlots");

            migrationBuilder.DropColumn(
                name: "ImportKey",
                table: "PlayTables");

            migrationBuilder.DropColumn(
                name: "IsFromSheet",
                table: "Games");
        }
    }
}
