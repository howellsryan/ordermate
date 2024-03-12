namespace ordermateAPI.DAL.Models;

public class StoreModel
{
    public int StoreId { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime LastModifiedDate { get; set; }
}