using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class DodawanieStolowIGierMod : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UserId",
                table: "TableSlots",
                type: "TEXT",
                maxLength: 450,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UserId",
                table: "TableSlots");
        }
    }
}
