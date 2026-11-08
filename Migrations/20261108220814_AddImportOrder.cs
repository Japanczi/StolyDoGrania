using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planszowkarz.Migrations
{
    /// <inheritdoc />
    public partial class AddImportOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ImportOrder",
                table: "PlayTables",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ImportOrder",
                table: "PlayTables");
        }
    }
}
