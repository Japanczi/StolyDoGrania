using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StolyDoGrania.Migrations
{
    /// <inheritdoc />
    public partial class RenameTableCreatorToOwner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "CreatorUserId",
                table: "PlayTables",
                newName: "OwnerUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "OwnerUserId",
                table: "PlayTables",
                newName: "CreatorUserId");
        }
    }
}
